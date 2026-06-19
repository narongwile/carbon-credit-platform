#pragma once
#include <Arduino.h>

// ===========================================================================
//  Audit-grade time (spec §10.1).
//  Priority: NTP (online) > DS3231 RTC (offline/brown-out) > uptime (pre-RTC).
//  On boot we seed the system clock from the RTC; when NTP later wins we step
//  the clock AND write it back to the RTC so the next offline window is accurate.
// ===========================================================================
void        ooTimeInit();          // I2C + RTC seed + start NTP
void        ooTimeTick();          // call ~1 Hz: detect NTP sync, discipline RTC
uint64_t    ooEpochMs();           // epoch ms (or uptime ms before any clock)
const char* ooTimeSrc();           // "ntp" | "rtc" | "uptime"
bool        ooRtcPresent();
