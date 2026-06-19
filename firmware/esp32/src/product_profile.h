#pragma once
#include <Arduino.h>
#include "oneops.h"

// ===========================================================================
//  Product profile / abstraction (spec §12). Everything above the driver layer
//  is product-agnostic; the profile selects the active channels, their units,
//  the base cadence and the edge-alarm thresholds (spec §6/§8). Adding a
//  product = adding a profile here.
// ===========================================================================
struct OoChannel {
  const char* sid;        // sensor id within the device (resolves CTI host_fk)
  const char* channel;    // spec channel name (oil_temp_c, temp_c, ...)
  const char* unit;       // "C" | "ppm" | "%" | "g" | "m" | "event"
  bool        isEvent;    // door_state / impact_g — boolean/event channel
  bool        invert;     // true => LOW value is bad (oil_level_pct, batt_pct)
  float       warn;       // warning threshold
  float       crit;       // critical threshold
  float       simMin;     // dev simulation range
  float       simMax;
};

struct OoProfile {
  const char*      product;
  const OoChannel* channels;
  size_t           count;
  uint32_t         sampleMs;
};

const OoProfile& ooGetProfile(const char* product);

// Dev sensor read (replace with the real driver in a hardware build).
float ooSimRead(const OoChannel& ch);

// Edge fast-path severity (spec §8/§9). For event channels: value!=0 => CRITICAL.
OoSeverity ooEvalSeverity(const OoChannel& ch, float value);
