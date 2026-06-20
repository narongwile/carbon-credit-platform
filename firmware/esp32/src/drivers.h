#pragma once
#include <Arduino.h>
#include "product_profile.h"

// ===========================================================================
//  Hardware abstraction — real sensor reads over the board's buses
//  (RS-485 Modbus, I2C SHT3x/BMP280/ADXL345, ADC, digital input), mapped per
//  product by OoChannel.bus (product_profile.h / board_pins.h).
//
//  A failed real read (sensor absent / NACK / CRC / timeout) returns
//  quality="error"; with OO_SIM_FALLBACK it instead returns a simulated value
//  tagged quality="sim" so the demo runs on a bare board. This feeds the spec
//  §16 `quality` field directly.
// ===========================================================================
struct OoReading {
  float       value;
  const char* quality;    // "good" | "sim" | "error"
};

void      ooDriversInit();
OoReading ooReadChannel(const OoChannel& ch);
// Drain the CAN/TWAI RX queue into the cache. MUST be called frequently
// (e.g. every 50 ms in SensorTask) so the hardware RX queue never overflows —
// not only at sample time. No-op if CAN is not active.
void      ooCanPoll();
