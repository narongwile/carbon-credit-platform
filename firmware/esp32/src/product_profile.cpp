#include "product_profile.h"
#include <string.h>

// Channel sets + thresholds per spec §6/§8. Sim ranges span the warn/crit bands
// so the alarm engine actually trips during a dev run.
//                sid   channel          unit    event  invert  warn   crit   simMin simMax
static const OoChannel ETERNITY[] = {
  {"t1", "oil_temp_c",     "C",   false, false, 80,   95,   55,  98},
  {"t2", "ambient_temp_c", "C",   false, false, 40,   50,   25,  45},
  {"g1", "dga_h2_ppm",     "ppm", false, false, 150,  300,  80,  320},
  {"m1", "moisture_ppm",   "ppm", false, false, 25,   35,   10,  38},
  {"l1", "oil_level_pct",  "%",   false, true,  70,   60,   58,  95},   // inverted
  {"p1", "load_pct",       "%",   false, false, 80,   95,   40,  99},
};
static const OoChannel CARBONBOX[] = {
  {"t1", "temp_c",     "C",     false, false, 6, 8, 2, 9},
  {"d1", "door_state", "event", true,  false, 0, 1, 0, 1},
};
static const OoChannel BLOODBOX[] = {
  {"t1", "temp_c",     "C",     false, false, 6,  7,   2,  8},
  {"h1", "rh_pct",     "%",     false, false, 80, 90,  40, 85},
  {"b1", "batt_pct",   "%",     false, true,  40, 20,  18, 100},  // inverted (low bad)
  {"a1", "impact_g",   "g",     true,  false, 3,  3,   0,  6},    // event > 3 g
  {"f1", "baro_alt_m", "m",     false, false, 0,  0,   0,  20},   // info only
};

static const OoProfile PROFILES[] = {
  {"eternity",  ETERNITY,  sizeof(ETERNITY)  / sizeof(OoChannel), 30000},
  {"carbonbox", CARBONBOX, sizeof(CARBONBOX) / sizeof(OoChannel), 30000},
  {"bloodbox",  BLOODBOX,  sizeof(BLOODBOX)  / sizeof(OoChannel), 15000},
};

const OoProfile& ooGetProfile(const char* product) {
  for (const auto& pr : PROFILES)
    if (strcmp(pr.product, product) == 0) return pr;
  return PROFILES[0];
}

float ooSimRead(const OoChannel& ch) {
  if (ch.isEvent) {
    if (strcmp(ch.unit, "g") == 0)                       // impact: occasional real g
      return (random(0, 100) < 4) ? (ch.crit + 1.0f) : (float)random(0, 200) / 100.0f;
    return (random(0, 100) < 5) ? 1.0f : 0.0f;           // door etc.: ~5% events
  }
  float span = ch.simMax - ch.simMin;
  return ch.simMin + (random(0, 1001) / 1000.0f) * span;
}

OoSeverity ooEvalSeverity(const OoChannel& ch, float value) {
  if (ch.isEvent) return value != 0.0f ? OO_CRITICAL : OO_NORMAL;
  if (ch.warn == 0 && ch.crit == 0) return OO_NORMAL;    // info-only channel
  if (ch.invert) {                                        // low is bad
    if (value <= ch.crit) return OO_CRITICAL;
    if (value <= ch.warn) return OO_WARNING;
  } else {                                                // high is bad
    if (value >= ch.crit) return OO_CRITICAL;
    if (value >= ch.warn) return OO_WARNING;
  }
  return OO_NORMAL;
}
