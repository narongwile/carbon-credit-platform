#pragma once
#include <Arduino.h>

// ===========================================================================
//  Local trend / rate-of-rise (spec: transformer DGA pre-empt). A small ring
//  per key gives an on-device gas-trend (e.g. H2 ppm/hour) so the firmware can
//  pre-empt a rising fault before the slow cloud cadence sees it.
// ===========================================================================
void  ooTrendPush(uint8_t key, uint64_t ts_ms, float value);
float ooTrendPerHour(uint8_t key);              // units/hour over the window (NaN if <2 pts)
