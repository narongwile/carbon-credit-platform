#include "product_profile.h"
#include <string.h>

// Channel sets + thresholds per spec §6/§8, each routed to its real bus/driver
// (board_pins.h + drivers.cpp). Sim ranges span the warn/crit bands so the
// alarm engine still trips when running on the simulator fallback.
//
// eternity: Modbus-RTU over RS-485 (oil/moisture/level) + a CAN DGA analyser and
//           CAN ambient probe + a current transformer on ADC (load).
//        sid   channel          unit  event invert warn crit simMin simMax  bus          arg
static const OoChannel ETERNITY[] = {
  {"t1","oil_temp_c",    "C",  false,false, 80, 95, 55, 98, BUS_MODBUS,  0},
  {"t2","ambient_temp_c","C",  false,false, 40, 50, 25, 45, BUS_CAN, OO_CAN_ID_AMBIENT},
  {"g1","dga_h2_ppm",    "ppm",false,false,150,300, 80,320, BUS_CAN, OO_CAN_ID_DGA},
  {"m1","moisture_ppm",  "ppm",false,false, 25, 35, 10, 38, BUS_MODBUS,  3},
  {"l1","oil_level_pct", "%",  false,true,  70, 60, 58, 95, BUS_MODBUS,  4},   // inverted
  {"p1","load_pct",      "%",  false,false, 80, 95, 40, 99, BUS_ADC, OO_PIN_CT_ADC},
};
// carbonbox: TMP117 precision probe + a door switch on a digital input.
static const OoChannel CARBONBOX[] = {
  {"t1","temp_c",    "C",    false,false, 6, 8, 2, 9, BUS_I2C_TMP117, 0},
  {"d1","door_state","event",true, false, 0, 1, 0, 1, BUS_DI, OO_PIN_DOOR_DI},
};
// bloodbox: SHT31 temp+rh, BMP280 altitude, ADXL345 impact, battery on ADC.
static const OoChannel BLOODBOX[] = {
  {"t1","temp_c",    "C", false,false, 6,  7,  2,  8, BUS_I2C_SHT31_T,  0},
  {"h1","rh_pct",    "%", false,false, 80, 90, 40, 85, BUS_I2C_SHT31_RH, 0},
  {"b1","batt_pct",  "%", false,true,  40, 20, 18,100, BUS_ADC_BATT, OO_PIN_BATT_ADC},
  {"a1","impact_g",  "g", false,false, 2.5f,3,  0,  6, BUS_I2C_ADXL345,  0},   // magnitude + threshold
  {"f1","baro_alt_m","m", false,false, 0,  0,  0, 20, BUS_I2C_BMP280,   0},
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
  if (ch.isEvent) return (random(0, 100) < 5) ? 1.0f : 0.0f;   // door etc.: ~5% events
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
