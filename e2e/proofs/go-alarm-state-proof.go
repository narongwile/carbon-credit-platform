package main

// Extracted verbatim from worker/main.go: the state struct keyed by param Key
// alone, and the breach/clear/dwell logic from evaluateAlarms — the exact
// state machine used for real alarms in production, minus DB/MQTT plumbing
// (the emit calls are replaced with a slice we can inspect).

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
	PrevValue   *float64
}

func breaches(v, l float64, dir string) bool {
	if dir == "high" {
		return v >= l
	}
	return v <= l
}

func cleared(v, l, h float64, dir string) bool {
	if dir == "high" {
		return v < l-h
	}
	return v > l+h
}

type Event struct {
	Key, Severity string
	Value         float64
}

func evaluateFrame(params map[string]*AlarmParamState, ruleParams []RuleParam, values map[string]float64, dwellMin int, hysteresis float64) []Event {
	var events []Event
	for _, p := range ruleParams {
		val, exists := values[p.Key]
		if !exists {
			continue
		}
		stateKey := p.Key + "\x1f" + p.Direction
		ps, ok := params[stateKey]
		if !ok {
			ps = &AlarmParamState{}
			params[stateKey] = ps
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
					events = append(events, Event{p.Key + ":" + p.Direction, lvl, val})
				}
				ps.ActiveLevel = lvl
			}
		} else if ps.ActiveLevel != "" && cleared(val, p.Warn, hysteresis, p.Direction) {
			ps.ActiveLevel = ""
			ps.RunCount = 0
		} else if lvl == "" {
			ps.RunCount = 0
		}
	}
	return events
}

func main() {
	// One physical measurement — VoltAN — with an over-voltage alarm
	// (direction 'high', 241.5/253) and an under-voltage alarm (direction
	// 'low', 218.5/207), exactly what "Over Voltage" and "Under Voltage" as
	// two separate compound-catalog entries pointed at the same real key
	// would look like once correctly keyed to real telemetry.
	ruleParams := []RuleParam{
		{Key: "VoltAN", Label: "Over Voltage", Warn: 241.5, Critical: 253, Direction: "high"},
		{Key: "VoltAN", Label: "Under Voltage", Warn: 218.5, Critical: 207, Direction: "low"},
	}
	state := map[string]*AlarmParamState{}
	dwellMin := 1
	hysteresis := 2.0

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

	// Reading 1: a real over-voltage event — 255V, clearly over critical (253),
	// nowhere near the under-voltage band (218.5/207).
	ev1 := evaluateFrame(state, ruleParams, map[string]float64{"VoltAN": 255}, dwellMin, hysteresis)
	fmt.Printf("frame 1 (VoltAN=255V, genuine over-voltage): %d event(s): %v\n", len(ev1), ev1)
	overVoltageRaised := false
	for _, e := range ev1 {
		if e.Key == "VoltAN:high" && e.Severity == "CRITICAL" {
			overVoltageRaised = true
		}
	}
	check("over-voltage CRITICAL raised on frame 1", overVoltageRaised, fmt.Sprintf("events=%v", ev1))

	// Frame 2: voltage stays at exactly the same 255V (no change at all).
	// A real over-voltage condition that hasn't moved must NOT self-clear.
	ev2 := evaluateFrame(state, ruleParams, map[string]float64{"VoltAN": 255}, dwellMin, hysteresis)
	stillActive := state["VoltAN\x1fhigh"].ActiveLevel == "CRITICAL"
	check("over-voltage alarm still ACTIVE one frame later, same 255V", stillActive,
		fmt.Sprintf("ActiveLevel=%q (want CRITICAL) — frame produced %d new event(s): %v", state["VoltAN\x1fhigh"].ActiveLevel, len(ev2), ev2))

	// Frame 3: voltage drops to a genuine under-voltage reading (200V, below
	// the 207 critical-low threshold) — the over-voltage band must clear
	// (voltage is no longer high) and the under-voltage band must raise
	// independently, proving the two bands track separate state rather than
	// one clobbering the other in either direction.
	ev3 := evaluateFrame(state, ruleParams, map[string]float64{"VoltAN": 200}, dwellMin, hysteresis)
	overCleared := state["VoltAN\x1fhigh"].ActiveLevel == ""
	underActive := state["VoltAN\x1flow"].ActiveLevel == "CRITICAL"
	fmt.Printf("frame 3 (VoltAN=200V, genuine under-voltage): %d event(s): %v\n", len(ev3), ev3)
	check("over-voltage band cleared on genuine under-voltage reading", overCleared,
		fmt.Sprintf("ActiveLevel=%q", state["VoltAN\x1fhigh"].ActiveLevel))
	check("under-voltage band independently raised CRITICAL", underActive,
		fmt.Sprintf("ActiveLevel=%q events=%v", state["VoltAN\x1flow"].ActiveLevel, ev3))

	fmt.Println(fail == 0)
	if fail > 0 {
		fmt.Printf("\n%d passed, %d failed — the under-voltage RuleParam entry (processed second, same map key) overwrote the state the over-voltage entry had just set.\n", pass, fail)
	} else {
		fmt.Printf("\n%d passed, %d failed\n", pass, fail)
	}
}
