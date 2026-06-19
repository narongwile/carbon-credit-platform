#pragma once
#include <Arduino.h>
#include "oneops.h"

// ===========================================================================
//  Product profile / abstraction (spec §12). Everything above the driver layer
//  is product-agnostic; the profile selects the active channels, their units,
//  the base cadence and the edge-alarm thresholds (spec §6/§8). Adding a
//  product = adding a profile here.
// ===========================================================================
// Which hardware bus / driver provides a channel (drivers.cpp).
enum OoBus : uint8_t {
  BUS_SIM = 0,        // simulated only (no hardware)
  BUS_I2C_SHT31_T,    // SHT31 temperature (C)
  BUS_I2C_SHT31_RH,   // SHT31 humidity (%)
  BUS_I2C_TMP117,     // TMP117 precision temperature (C)
  BUS_I2C_BMP280,     // BMP280 altitude (m)
  BUS_I2C_ADXL345,    // ADXL345 |a|-1g (g)
  BUS_ADC,            // analog pin (arg = gpio) -> 0..100 %
  BUS_ADC_BATT,       // battery divider (arg = gpio) -> %
  BUS_DI,             // digital input (arg = gpio), debounced event
  BUS_MODBUS,         // RS-485 Modbus holding reg (arg = reg), value = reg/10
  BUS_CAN,            // TWAI/CAN frame (arg = CAN id); data[0..1] int16 BE / 10
};

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
  OoBus       bus;        // real driver to read this channel (drivers.cpp)
  uint16_t    arg;        // bus argument: i2c n/a | adc/di gpio | modbus reg
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
