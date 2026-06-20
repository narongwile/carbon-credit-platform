#pragma once
#include <Arduino.h>
#include "transit.h"

// ===========================================================================
//  Power policy (bloodbox battery + transit). Reads the real battery and makes
//  the sample cadence transit-aware: fast while in transit, slow when stored,
//  slower on low battery. ooEnterDeepSleep() is provided for a duty-cycle build
//  (wake -> sample -> publish -> sleep); the always-on demo uses cadence only.
// ===========================================================================
void     ooPowerInit();
float    ooBatteryPct();                              // real ADC %, or 100 if no batt pin
uint32_t ooPowerSampleMs(uint32_t baseMs, OoTransit state, float battPct);
void     ooEnterDeepSleep(uint32_t seconds);          // timer (+ IMU ext0) wake
bool     ooWokeOnImpact();                            // true if this boot woke from the IMU INT
