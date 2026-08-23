package main

// The two identity controls from worker/main.go, extracted verbatim:
//
//   topicNodeID  — a frame's topic and its payload must name the same node.
//                  MQTT authorises a PUBLISH by TOPIC; the payload is opaque
//                  to the broker's ACL. Trusting the payload's nodeId means a
//                  device allowed to publish only its own topic can still
//                  write readings and raise alarms as any other node in any
//                  other org, just by naming it in the body.
//
//   noteUptime   — two boards flashed from one firmware image both claim the
//                  same nodeId, and MQTT gives a subscriber no publisher
//                  identity to tell them apart (paho's Message is
//                  Topic/Payload/Qos/Retained — nothing else). Uptime is the
//                  in-band evidence: it only climbs for one device, and jumps
//                  backwards on roughly every other frame when two alternate.
//                  A reboot regresses ONCE, so the count is what separates
//                  them.
//
// Run: go run e2e/proofs/go-identity-proof.go

import (
	"fmt"
	"strings"
	"time"
)

// --- verbatim from worker/main.go ---
func topicNodeID(topic string) string {
	parts := strings.Split(topic, "/")
	if len(parts) < 4 || parts[0] != "telemetry" {
		return ""
	}
	return parts[3]
}

const (
	uptimeRegressionWindow    = 15 * time.Minute
	uptimeRegressionThreshold = 3
)

func noteUptime(prevUptime *int64, reported int64, regressions int, windowStart *time.Time, now time.Time, otaGrace bool) (int, time.Time, bool) {
	if prevUptime == nil || reported >= *prevUptime {
		if windowStart == nil {
			return regressions, now, false
		}
		return regressions, *windowStart, false
	}
	if otaGrace {
		if windowStart == nil {
			return regressions, now, false
		}
		return regressions, *windowStart, false
	}
	if windowStart == nil || now.Sub(*windowStart) > uptimeRegressionWindow {
		return 1, now, false
	}
	next := regressions + 1
	return next, *windowStart, next >= uptimeRegressionThreshold
}

// --- harness ---
var pass, fail int

func check(name string, ok bool, detail string) {
	v := "FAIL"
	if ok {
		v = "PASS"
	}
	fmt.Printf("%s %s  %s\n", v, name, detail)
	if ok {
		pass++
	} else {
		fail++
	}
}

// feed replays a series of uptimes 30s apart (the fleet's heartbeat interval)
// and reports whether the node ends up flagged, and after how many frames.
func feed(uptimes []int64, ota bool) (flagged bool, atFrame int) {
	var prev *int64
	var window *time.Time
	regressions := 0
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i, u := range uptimes {
		now := t0.Add(time.Duration(i) * 30 * time.Second)
		var f bool
		regressions, _, f = func() (int, time.Time, bool) {
			r, w, fl := noteUptime(prev, u, regressions, window, now, ota)
			window = &w
			return r, w, fl
		}()
		v := u
		prev = &v
		if f && !flagged {
			flagged, atFrame = true, i+1
		}
	}
	return
}

func main() {
	// ================= topic vs payload identity =================
	check("a well-formed telemetry topic yields its node id",
		topicNodeID("telemetry/org-1/eternity/tr-111") == "tr-111", "")
	check("a subtopic keeps the node id in the same position",
		topicNodeID("telemetry/org-1/eternity/tr-222/alarm/hydrogen") == "tr-222", "")
	check("a topic that is too short yields nothing (cannot validate)",
		topicNodeID("telemetry/org-1/eternity") == "", "")
	check("a non-telemetry topic yields nothing",
		topicNodeID("cmd/tr-111/reboot") == "", "")

	// The attack this closes: publish on a topic you ARE allowed to use, but
	// name a different node in the body.
	claimed := topicNodeID("telemetry/org-1/eternity/tr-221")
	spoofedPayloadNode := "tr-111"
	check("a payload naming a DIFFERENT node than its topic is detectable",
		claimed != "" && claimed != spoofedPayloadNode,
		fmt.Sprintf("topic names %q, payload claims %q", claimed, spoofedPayloadNode))
	check("a matching payload is not flagged",
		topicNodeID("telemetry/org-1/eternity/tr-111") == "tr-111", "")

	// ================= duplicate identity via uptime =================

	// One device, steady climb — the ordinary case, must never flag.
	up := make([]int64, 40)
	for i := range up {
		up[i] = int64(10000 + i*30)
	}
	f, _ := feed(up, false)
	check("a healthy device climbing steadily is never flagged", !f, "40 frames")

	// One reboot: a single backwards jump, then a fresh climb.
	reboot := []int64{10000, 10030, 10060, 12, 42, 72, 102, 132}
	f, _ = feed(reboot, false)
	check("a single reboot does NOT flag (one regression is normal)", !f,
		fmt.Sprintf("%v", reboot))

	// Two reboots inside the window still stay under the threshold of 3.
	twice := []int64{10000, 10030, 20, 50, 80, 15, 45, 75}
	f, _ = feed(twice, false)
	check("two reboots inside the window still do not flag", !f, "threshold is 3")

	// Two boards alternating under one id: each frame reports its own board's
	// uptime, so it regresses on every other frame.
	var alternating []int64
	a, b := int64(50000), int64(400)
	for i := 0; i < 12; i++ {
		alternating = append(alternating, a, b)
		a += 60
		b += 60
	}
	f, at := feed(alternating, false)
	check("two devices alternating under one id ARE flagged", f,
		fmt.Sprintf("flagged at frame %d of %d", at, len(alternating)))
	check("and flagged quickly, not after hours", f && at <= 8,
		fmt.Sprintf("frame %d = %ds of heartbeats", at, at*30))

	// A boot loop also regresses repeatedly — equally worth an operator's
	// attention, which is why the flag is named for the evidence.
	bootloop := []int64{900, 30, 60, 25, 55, 20, 50}
	f, _ = feed(bootloop, false)
	check("a boot-looping device is flagged too", f, "same evidence, same flag")

	// An OTA rollout reboots every device it touches — must not flag the fleet.
	f, _ = feed(alternating, true)
	check("regressions inside the OTA grace window never count", !f,
		"a firmware rollout must not flag every device")

	// Window expiry: regressions weeks apart must not accumulate.
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	prev := int64(10000)
	win := t0
	regr := 2 // two earlier regressions, window already open
	// A regression arriving long after the window opened restarts the count.
	n, _, flagged := noteUptime(&prev, 5, regr, &win, t0.Add(24*time.Hour), false)
	check("a regression after the window expired restarts the count at 1",
		n == 1 && !flagged, fmt.Sprintf("count=%d flagged=%v", n, flagged))

	// The very first uptime ever seen has nothing to compare against.
	n, _, flagged = noteUptime(nil, 12345, 0, nil, t0, false)
	check("the first uptime ever seen is not a regression", n == 0 && !flagged, "")

	fmt.Printf("\n%d passed, %d failed\n", pass, fail)
	if fail > 0 {
		panic("identity proof failed")
	}
}
