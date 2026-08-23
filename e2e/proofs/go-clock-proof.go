package main

// Device-clock sanity and rate-anchor recovery, extracted verbatim from
// worker/main.go.
//
// A device timestamp used to be trusted on the single test `> 0`, which lets
// through every way an ESP32 clock actually goes wrong — and each failure is
// silent:
//
//   • seconds sent where milliseconds are expected: 1787402633520 published as
//     1787402633 reads back as 1970-01-21, 56 years in the past.
//   • publishing before NTP has synced: time() is near zero, same result.
//   • a clock set into the future: nothing bounded that at all.
//
// A past-dated reading is stored, rolled into a phantom rollup bucket, then
// deleted by the next retention pass for being older than
// READINGS_RETENTION_DAYS. The operator sees a device that is plainly online
// reporting no data, and no error anywhere says why.
//
// A future-dated one is worse. It is never purged, never lands in a "last 24h"
// window, and it poisons AlarmParamState.PrevValueTs — after which every real
// frame computes a NEGATIVE elapsed, fails the minimum-span test, and never
// reaches the line that advances the anchor. Rate-of-rise stays dead for that
// parameter until the worker restarts.
//
// Run: go run e2e/proofs/go-clock-proof.go

import (
	"fmt"
	"time"
)

// --- verbatim from worker/main.go ---
const (
	maxClockLag       = 90 * 24 * time.Hour
	maxClockSkewAhead = 5 * time.Minute
)

// acceptTimestamp, with `now` injected so the proof is deterministic.
func acceptTimestamp(epochMs int64, now time.Time) (time.Time, bool) {
	if epochMs <= 0 {
		return now, true
	}
	ts := time.UnixMilli(epochMs)
	if ts.After(now.Add(maxClockSkewAhead)) {
		return now, true
	}
	if now.Sub(ts) > maxClockLag {
		return now, true
	}
	return ts, false
}

const rateMinDivisor = 24

type paramState struct {
	PrevValue   *float64
	PrevValueTs time.Time
}

// The rate branch from evaluateAlarms, including the re-anchor added with this
// fix. Returns whether a rate alarm fired.
func rateStep(ps *paramState, val float64, ts time.Time, rateWin time.Duration, warn float64) bool {
	if rateWin <= 0 {
		return false
	}
	if ps.PrevValue == nil {
		v := val
		ps.PrevValue, ps.PrevValueTs = &v, ts
		return false
	}
	if ts.Before(ps.PrevValueTs) {
		v := val
		ps.PrevValue, ps.PrevValueTs = &v, ts
		return false
	}
	if elapsed := ts.Sub(ps.PrevValueTs); elapsed >= rateWin/rateMinDivisor {
		d := (val - *ps.PrevValue) * float64(rateWin) / float64(elapsed)
		v := val
		ps.PrevValue, ps.PrevValueTs = &v, ts
		return d >= warn
	}
	return false
}

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

func main() {
	now := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)

	// ================= clock sanity =================
	good := now.Add(-30 * time.Second).UnixMilli()
	ts, replaced := acceptTimestamp(good, now)
	check("a normal recent timestamp is used as-is", !replaced && ts.UnixMilli() == good, "")

	ts, replaced = acceptTimestamp(0, now)
	check("a missing timestamp falls back to arrival time", replaced && ts.Equal(now), "")

	// The classic firmware slip: milliseconds divided by 1000.
	asSeconds := now.UnixMilli() / 1000
	ts, replaced = acceptTimestamp(asSeconds, now)
	check("SECONDS sent where ms expected is rejected, not stored in 1970",
		replaced && ts.Equal(now),
		fmt.Sprintf("%d would have read back as %s", asSeconds, time.UnixMilli(asSeconds).Format("2006-01-02")))

	ts, replaced = acceptTimestamp(45_000, now)
	check("millis()-since-boot (no NTP) is rejected", replaced && ts.Equal(now),
		fmt.Sprintf("45000 -> %s", time.UnixMilli(45_000).Format("2006-01-02")))

	future := now.Add(48 * time.Hour).UnixMilli()
	ts, replaced = acceptTimestamp(future, now)
	check("a future timestamp is rejected", replaced && ts.Equal(now), "")

	// Bounds must not be so tight that ordinary operation trips them.
	jitter := now.Add(2 * time.Minute).UnixMilli()
	ts, replaced = acceptTimestamp(jitter, now)
	check("small NTP jitter ahead of now is still accepted", !replaced && ts.UnixMilli() == jitter,
		"2 min ahead, inside the 5 min allowance")

	backlog := now.Add(-20 * 24 * time.Hour).UnixMilli()
	ts, replaced = acceptTimestamp(backlog, now)
	check("a genuine 20-day offline backlog is NOT rejected", !replaced && ts.UnixMilli() == backlog,
		"store-and-forward catch-up must survive")

	old := now.Add(-120 * 24 * time.Hour).UnixMilli()
	_, replaced = acceptTimestamp(old, now)
	check("but 120 days back is treated as a broken clock", replaced, "beyond the 90-day window")

	// ================= rate anchor recovery =================
	// A future-dated frame lands first and sets the anchor ahead of real time.
	ps := &paramState{}
	rateWin := 24 * time.Hour // 'ppm/day'
	rateStep(ps, 100, now.Add(72*time.Hour), rateWin, 10)
	check("a future-dated frame sets the anchor ahead of now",
		ps.PrevValueTs.After(now), ps.PrevValueTs.Format(time.RFC3339))

	// Then real frames arrive, climbing 10 ppm/day for three days.
	fired := 0
	for i := 0; i <= 3*1440; i++ {
		v := 100 + (10.0/1440.0)*float64(i)
		if rateStep(ps, v, now.Add(time.Duration(i)*time.Minute), rateWin, 10) {
			fired++
		}
	}
	check("rate-of-rise RECOVERS after a poisoned anchor and still fires", fired > 0,
		fmt.Sprintf("%d rate alarm(s) on a real +10 ppm/day trend", fired))

	// The same trend on a clean anchor, for comparison — recovery must not
	// come at the cost of a flood.
	ps2 := &paramState{}
	fired2 := 0
	for i := 0; i <= 3*1440; i++ {
		v := 100 + (10.0/1440.0)*float64(i)
		if rateStep(ps2, v, now.Add(time.Duration(i)*time.Minute), rateWin, 10) {
			fired2++
		}
	}
	check("recovery does not inflate the alarm count vs a clean anchor",
		fired <= fired2, fmt.Sprintf("poisoned=%d clean=%d", fired, fired2))

	// A backlog replay (older frames after newer ones) must re-anchor, not stall.
	ps3 := &paramState{PrevValue: func() *float64 { v := 100.0; return &v }(), PrevValueTs: now}
	rateStep(ps3, 101, now.Add(-6*time.Hour), rateWin, 10)
	check("an out-of-order backlog frame re-anchors instead of stalling",
		ps3.PrevValueTs.Equal(now.Add(-6*time.Hour)), ps3.PrevValueTs.Format(time.RFC3339))

	fmt.Printf("\n%d passed, %d failed\n", pass, fail)
	if fail > 0 {
		panic("clock proof failed")
	}
}
