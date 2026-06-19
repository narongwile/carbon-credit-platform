#pragma once
#include <Arduino.h>

// ===========================================================================
//  Minimal NMEA (RMC) GPS — outdoor transit position (bloodbox). No external
//  library: reads $--RMC sentences off a UART and exposes fix/lat/lng/speed.
// ===========================================================================
void  ooGpsInit();
void  ooGpsTick();                 // call often; non-blocking parse
bool  ooGpsFix();
float ooGpsLat();
float ooGpsLng();
float ooGpsSpeedKnots();
