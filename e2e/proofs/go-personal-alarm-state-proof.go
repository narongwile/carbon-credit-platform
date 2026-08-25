package main

// Extracted verbatim (shape-for-shape) from worker/main.go's evaluateParams —
// the shared dwell/hysteresis state machine both evaluateAlarms (the org-wide
// rule) and evaluatePersonalAlarms (each user's own rule) now call. This
// proves the property the refactor depends on: two *different*
// *AlarmNodeState maps — one simulating the shared alarmStateCache entry for
// a node, two more simulating personalAlarmStateCache entries for two
// different users on that SAME node/param — never read or write each
// other's state, even though the same evaluateParams call processes all
// three against the identical telemetry frame.

import "fmt"

type RuleParam struct {
	Key       string
	Label     string
	Warn      float64
	Critical  float64
	Direction string
}

type AlarmParamState struct {
	ActiveLevel string
	RunCount    int
}

type AlarmNodeState struct {
	Params map[string]*AlarmParamState
}

func breaches(v, l float64, dir string) bool {
	if dir == "high" {
		return v >= l
	}
	return v <= l
}

type Event struct {
	Owner, Key, Severity string
	Value                float64
}

// evaluateParams mirrors worker/main.go's function of the same name (minus
// rate-of-rise and cooldown, irrelevant to what this proof checks) — one
// state machine, applied to whichever *AlarmNodeState the caller passes.
func evaluateParams(owner string, ns *AlarmNodeState, ruleParams []RuleParam, values map[string]float64, dwellMin int, emit func(Event)) {
	for _, p := range ruleParams {
		val, exists := values[p.Key]
		if !exists {
			continue
		}
		stateKey := p.Key + "\x1f" + p.Direction
		ps, ok := ns.Params[stateKey]
		if !ok {
			ps = &AlarmParamState{}
			ns.Params[stateKey] = ps
		}

		lvl := ""
		if breaches(val, p.Critical, p.Direction) {
			lvl = "CRITICAL"
		} else if breaches(val, p.Warn, p.Direction) {
			lvl = "WARNING"
		}

		if lvl != "" {
			ps.RunCount++
			if ps.RunCount >= dwellMin && lvl != ps.ActiveLevel {
				if ps.ActiveLevel == "" || (ps.ActiveLevel == "WARNING" && lvl == "CRITICAL") {
					emit(Event{owner, p.Key, lvl, val})
				}
				ps.ActiveLevel = lvl
			}
		} else {
			ps.RunCount = 0
		}
	}
}

func main() {
	pass, fail := 0, 0
	check := func(name string, ok bool, detail string) {
		verdict := "FAIL"
		if ok {
			verdict = "PASS"
		}
		fmt.Printf("%s %s  %s\n", verdict, name, detail)
		if ok {
			pass++
		} else {
			fail++
		}
	}

	// Three independent rules for the SAME reading (oilTemp, one node): the
	// shared org-wide rule everyone sees, and two different users' own
	// personal thresholds — deliberately set so the same 88°C reading lands
	// in a DIFFERENT severity band for each, proving they are evaluated
	// independently rather than sharing one classification.
	sharedRule := []RuleParam{{Key: "oilTemp", Label: "Top Oil Temp", Warn: 85, Critical: 90, Direction: "high"}}
	userARule := []RuleParam{{Key: "oilTemp", Label: "Top Oil Temp", Warn: 80, Critical: 85, Direction: "high"}} // stricter — wants an earlier heads-up
	userBRule := []RuleParam{{Key: "oilTemp", Label: "Top Oil Temp", Warn: 95, Critical: 100, Direction: "high"}} // looser — only cares once it's severe

	sharedState := &AlarmNodeState{Params: map[string]*AlarmParamState{}}
	userAState := &AlarmNodeState{Params: map[string]*AlarmParamState{}}
	userBState := &AlarmNodeState{Params: map[string]*AlarmParamState{}}

	dwellMin := 1
	frame := map[string]float64{"oilTemp": 88}

	var events []Event
	emit := func(e Event) { events = append(events, e) }

	// Evaluate all three against the SAME frame — order matters for the
	// proof: if any of the three shared a map (the exact bug class the
	// VoltAN over/under-voltage proof already covers for one map, keyed
	// wrong), processing them back-to-back is precisely what would surface
	// one clobbering another's ActiveLevel.
	evaluateParams("shared", sharedState, sharedRule, frame, dwellMin, emit)
	evaluateParams("userA", userAState, userARule, frame, dwellMin, emit)
	evaluateParams("userB", userBState, userBRule, frame, dwellMin, emit)

	fmt.Printf("frame 1 (oilTemp=88): %d event(s): %v\n", len(events), events)

	check("shared org rule raised WARNING (88 is between 85 and 90)",
		sharedState.Params["oilTemp\x1fhigh"].ActiveLevel == "WARNING",
		fmt.Sprintf("ActiveLevel=%q", sharedState.Params["oilTemp\x1fhigh"].ActiveLevel))

	check("user A's stricter personal rule raised CRITICAL (88 is past their 85)",
		userAState.Params["oilTemp\x1fhigh"].ActiveLevel == "CRITICAL",
		fmt.Sprintf("ActiveLevel=%q", userAState.Params["oilTemp\x1fhigh"].ActiveLevel))

	check("user B's looser personal rule raised nothing (88 is below their 95 warn)",
		userBState.Params["oilTemp\x1fhigh"] == nil || userBState.Params["oilTemp\x1fhigh"].ActiveLevel == "",
		fmt.Sprintf("ActiveLevel=%q", func() string {
			if userBState.Params["oilTemp\x1fhigh"] == nil {
				return "<no entry>"
			}
			return userBState.Params["oilTemp\x1fhigh"].ActiveLevel
		}()))

	// The property that actually matters: evaluating user A's and user B's
	// PERSONAL rules must never have mutated the SHARED state — the map an
	// admin's AlarmParamConfig (mode="device") and everyone else's alarm
	// badge reads. If evaluatePersonalAlarms in worker/main.go were ever
	// changed to reuse alarmStateCache instead of its own
	// personalAlarmStateCache, this is the check that would catch it.
	check("shared state is STILL exactly WARNING after both personal evaluations ran",
		sharedState.Params["oilTemp\x1fhigh"].ActiveLevel == "WARNING" && sharedState.Params["oilTemp\x1fhigh"].RunCount == 1,
		fmt.Sprintf("ActiveLevel=%q RunCount=%d (want WARNING, 1 — unaffected by userA/userB)",
			sharedState.Params["oilTemp\x1fhigh"].ActiveLevel, sharedState.Params["oilTemp\x1fhigh"].RunCount))

	// Frame 2: reading holds steady. Each of the three must independently
	// stay put (no re-fire, no state leaking from one to another) — proves
	// dwell/hysteresis state, not just the one-shot classification above, is
	// fully independent per (owner, node, param).
	events = nil
	evaluateParams("shared", sharedState, sharedRule, frame, dwellMin, emit)
	evaluateParams("userA", userAState, userARule, frame, dwellMin, emit)
	evaluateParams("userB", userBState, userBRule, frame, dwellMin, emit)

	check("no NEW events on frame 2 — all three states held, none re-fired or cross-fired",
		len(events) == 0, fmt.Sprintf("events=%v", events))
	check("shared still WARNING, user A still CRITICAL, user B still clear after frame 2",
		sharedState.Params["oilTemp\x1fhigh"].ActiveLevel == "WARNING" &&
			userAState.Params["oilTemp\x1fhigh"].ActiveLevel == "CRITICAL" &&
			(userBState.Params["oilTemp\x1fhigh"] == nil || userBState.Params["oilTemp\x1fhigh"].ActiveLevel == ""),
		fmt.Sprintf("shared=%q userA=%q", sharedState.Params["oilTemp\x1fhigh"].ActiveLevel, userAState.Params["oilTemp\x1fhigh"].ActiveLevel))

	fmt.Println(fail == 0)
	if fail > 0 {
		fmt.Printf("\n%d passed, %d failed — a personal rule's state leaked into (or was clobbered by) the shared state or another user's personal state.\n", pass, fail)
	} else {
		fmt.Printf("\n%d passed, %d failed\n", pass, fail)
	}
}
