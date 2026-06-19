#include "transit.h"

static OoTransit gState   = TRANSIT_IDLE;
static uint64_t  gLastMove = 0;     // last time motion was seen
static uint64_t  gSince    = 0;     // time the current state was entered

static void enter(OoTransit s, uint64_t now) { if (s != gState) { gState = s; gSince = now; } }

void ooTransitInit() { gState = TRANSIT_IDLE; gLastMove = 0; gSince = 0; }

OoTransit ooTransitTick(float impactG, float gpsSpeedKnots, uint64_t now) {
  bool moving = (impactG > 0.15f) || (gpsSpeedKnots > 2.0f);   // accel noise floor / walking pace
  if (moving) gLastMove = now;
  uint64_t still = now - gLastMove;

  switch (gState) {
    case TRANSIT_IDLE:
      if (moving) enter(TRANSIT_IN_TRANSIT, now);
      break;
    case TRANSIT_IN_TRANSIT:
      if (still > 30000) enter(TRANSIT_ARRIVED, now);          // stationary 30 s
      break;
    case TRANSIT_ARRIVED:
      if (moving) enter(TRANSIT_IN_TRANSIT, now);
      else if (still > 300000) enter(TRANSIT_STORED, now);      // stationary 5 min
      break;
    case TRANSIT_STORED:
      if (moving) enter(TRANSIT_IN_TRANSIT, now);
      break;
  }
  return gState;
}

const char* ooTransitName(OoTransit s) {
  switch (s) {
    case TRANSIT_IN_TRANSIT: return "in_transit";
    case TRANSIT_ARRIVED:    return "arrived";
    case TRANSIT_STORED:     return "stored";
    default:                 return "idle";
  }
}
