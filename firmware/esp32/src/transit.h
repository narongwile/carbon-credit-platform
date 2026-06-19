#pragma once
#include <Arduino.h>

// ===========================================================================
//  BloodBOX transit state machine: idle -> in_transit -> arrived -> stored,
//  driven by motion (accel impact magnitude) and GPS speed. Used to drive the
//  power policy (sample cadence) and to annotate telemetry.
// ===========================================================================
enum OoTransit { TRANSIT_IDLE = 0, TRANSIT_IN_TRANSIT, TRANSIT_ARRIVED, TRANSIT_STORED };

void        ooTransitInit();
OoTransit   ooTransitTick(float impactG, float gpsSpeedKnots, uint64_t nowMs);
const char* ooTransitName(OoTransit s);
