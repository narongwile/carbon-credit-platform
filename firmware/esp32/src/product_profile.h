#pragma once
#include <Arduino.h>
// ===========================================================================
// Product profile / abstraction layer (spec §12). Everything above the driver
// layer is product-agnostic; the profile selects which channels are active,
// their units, and the base sample cadence. Adding a product = a profile here.
// ===========================================================================

struct OoChannel {
  const char* sid;      // sensor id within the device (resolves CTI host_fk spec table)
  const char* channel;  // spec channel name (oil_temp_c, temp_c, dga_h2_ppm, ...)
  const char* unit;     // "C", "ppm", "%", "g", "m", "event"
  bool        isEvent;  // door_state / impact_g — boolean event channel (spec §6)
  float       simMin;   // simulated range (dev — real builds read the driver)
  float       simMax;
};

struct OoProfile {
  const char*       product;
  const OoChannel*  channels;
  size_t            count;
  uint32_t          sampleMs;
};

// Select the active profile by product id (strcmp; defaults to eternity).
const OoProfile& ooGetProfile(const char* product);

// Dev sensor read — returns a plausible value (or 0/1 for event channels).
// Replace with the real driver read in a hardware build.
float ooSimRead(const OoChannel& ch);
