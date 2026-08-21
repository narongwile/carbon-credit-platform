package main

// The rate-of-rise logic extracted verbatim from worker/main.go's
// evaluateAlarms — the engine that actually runs against live MQTT telemetry.
// Confirms it agrees with the Node-RED engine proved in test-rate-of-rise.mjs:
// a rate is change per unit time in the unit the rule declares, not a raw
// frame-to-frame delta.
//
// Run: go run e2e/proofs/go-rate-of-rise-proof.go

import (
	"fmt"
	"strings"
	"time"
)

type rateSpec struct {
	Unit string
	Warn float64
}

type ruleParam struct {
	Direction string
	Rate      *rateSpec
}

type paramState struct {
	PrevValue   *float64
	PrevValueTs time.Time
}

// --- verbatim from worker/main.go ---
func rateWindow(unit string) time.Duration {
	u := strings.ToLower(strings.TrimSpace(unit))
	i := strings.LastIndex(u, "/")
	if i < 0 {
		return 0
	}
	switch strings.TrimSpace(u[i+1:]) {
	case "day", "d":
		return 24 * time.Hour
	case "hour", "hr", "h":
		return time.Hour
	case "min", "minute":
		return time.Minute
	case "sec", "second", "s":
		return time.Second
	}
	return 0
}

const rateMinDivisor = 24

func rateWindowFor(p ruleParam) time.Duration {
	if p.Rate == nil {
		return 0
	}
	return rateWindow(p.Rate.Unit)
}

// feed replays a series of (value, timestamp) frames through the same rate
// branch evaluateAlarms runs, returning how many rate alarms it would emit.
func feed(p ruleParam, vals []float64, times []time.Time) int {
	ps := &paramState{}
	fired := 0
	for i, val := range vals {
		ts := times[i]
		if rateWin := rateWindowFor(p); rateWin > 0 {
			if ps.PrevValue == nil {
				v := val
				ps.PrevValue = &v
				ps.PrevValueTs = ts
			} else if elapsed := ts.Sub(ps.PrevValueTs); elapsed >= rateWin/rateMinDivisor {
				delta := val - *ps.PrevValue
				if p.Direction != "high" {
					delta = *ps.PrevValue - val
				}
				d := delta * float64(rateWin) / float64(elapsed)
				if d >= p.Rate.Warn {
					fired++
				}
				v := val
				ps.PrevValue = &v
				ps.PrevValueTs = ts
			}
		}
	}
	return fired
}

func series(perDay float64, days int) ([]float64, []time.Time) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	n := days * 1440
	vals := make([]float64, n+1)
	times := make([]time.Time, n+1)
	for i := 0; i <= n; i++ {
		vals[i] = 100 + (perDay/1440)*float64(i)
		times[i] = t0.Add(time.Duration(i) * time.Minute)
	}
	return vals, times
}

func main() {
	pass, fail := 0, 0
	check := func(name string, ok bool, detail string) {
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

	h2 := ruleParam{Direction: "high", Rate: &rateSpec{Unit: "ppm/day", Warn: 10}}

	v, ts := series(10, 3)
	n := feed(h2, v, ts)
	check("a real +10 ppm/day trend fires the 10 ppm/day alarm", n > 0, fmt.Sprintf("%d rate alarm(s)", n))

	v, ts = series(4, 3)
	n = feed(h2, v, ts)
	check("a +4 ppm/day trend does NOT fire a 10 ppm/day alarm", n == 0, fmt.Sprintf("%d rate alarm(s)", n))

	// One 10 ppm step across 60s: the raw delta equals the limit, but the
	// samples are an hour short of the minimum span for a /day rate.
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	n = feed(h2,
		[]float64{100, 110, 110},
		[]time.Time{t0, t0.Add(time.Minute), t0.Add(2 * time.Minute)})
	check("a 10 ppm step across 60s does not fire on the raw delta", n == 0, fmt.Sprintf("%d rate alarm(s)", n))

	// Thermal, a different time base read from the same unit string.
	therm := ruleParam{Direction: "high", Rate: &rateSpec{Unit: "°C/h", Warn: 3}}
	tv := make([]float64, 121)
	tt := make([]time.Time, 121)
	for i := 0; i <= 120; i++ { // +6 °C/h for two hours
		tv[i] = 50 + (6.0/60.0)*float64(i)
		tt[i] = t0.Add(time.Duration(i) * time.Minute)
	}
	check("+6 °C/h fires a 3 °C/h alarm", feed(therm, tv, tt) > 0, "")
	cold := ruleParam{Direction: "high", Rate: &rateSpec{Unit: "°C/h", Warn: 12}}
	check("+6 °C/h does NOT fire a 12 °C/h alarm", feed(cold, tv, tt) == 0, "")

	// No interpretable denominator → rate check disabled, not fallen back on.
	noUnit := ruleParam{Direction: "high", Rate: &rateSpec{Unit: "ppm", Warn: 10}}
	n = feed(noUnit, []float64{100, 100000}, []time.Time{t0, t0.Add(2 * time.Hour)})
	check("a unit with no time base skips the rate check", n == 0, fmt.Sprintf("%d rate alarm(s)", n))

	// Identical timestamps must not divide by zero.
	n = feed(h2, []float64{100, 900}, []time.Time{t0, t0})
	check("duplicate timestamps do not produce an Infinity rate", n == 0, fmt.Sprintf("%d rate alarm(s)", n))

	fmt.Printf("\n%d passed, %d failed\n", pass, fail)
	if fail > 0 {
		panic("rate-of-rise proof failed")
	}
}
