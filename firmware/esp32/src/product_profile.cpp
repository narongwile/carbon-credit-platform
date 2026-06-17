#include "product_profile.h"
#include <string.h>

// Channel sets per spec §6/§8. Simulated ranges span the warn/crit bands so the
// alarm engine actually trips during a dev run.
static const OoChannel ETERNITY[] = {
  {"t1", "oil_temp_c",     "C",   false, 55, 98},   // warn 80 / crit 95
  {"t2", "ambient_temp_c", "C",   false, 25, 45},
  {"g1", "dga_h2_ppm",     "ppm", false, 80, 320},  // warn 150 / crit 300
  {"m1", "moisture_ppm",   "ppm", false, 10, 38},
  {"l1", "oil_level_pct",  "%",   false, 58, 95},   // inverted: low is bad
  {"p1", "load_pct",       "%",   false, 40, 99},
};

static const OoChannel CARBONBOX[] = {
  {"t1", "temp_c",     "C",     false, 2, 9},        // warn 6 / crit 8
  {"d1", "door_state", "event", true,  0, 1},        // door open event
};

static const OoChannel BLOODBOX[] = {
  {"t1", "temp_c",     "C",     false, 2, 8},        // medical: warn 6 / crit 7
  {"h1", "rh_pct",     "%",     false, 40, 85},
  {"b1", "batt_pct",   "%",     false, 18, 100},     // low is bad
  {"a1", "impact_g",   "g",     true,  0, 4},        // shock event > 3 g
  {"f1", "baro_alt_m", "m",     false, 0, 20},       // floor / altitude
};

static const OoProfile PROFILES[] = {
  {"eternity",  ETERNITY,  sizeof(ETERNITY) / sizeof(OoChannel),  30000},
  {"carbonbox", CARBONBOX, sizeof(CARBONBOX) / sizeof(OoChannel), 30000},
  {"bloodbox",  BLOODBOX,  sizeof(BLOODBOX) / sizeof(OoChannel),  15000},
};

const OoProfile& ooGetProfile(const char* product) {
  for (const auto& pr : PROFILES)
    if (strcmp(pr.product, product) == 0) return pr;
  return PROFILES[0];
}

float ooSimRead(const OoChannel& ch) {
  if (ch.isEvent) return (random(0, 100) < 5) ? 1.0f : 0.0f;   // ~5% event rate
  float span = ch.simMax - ch.simMin;
  return ch.simMin + (random(0, 1001) / 1000.0f) * span;
}
