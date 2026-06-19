#include "drivers.h"
#include "config.h"
#include <Wire.h>
#include <math.h>
#include "driver/twai.h"    // CAN controller

#if OO_USE_REAL_SENSORS

// ---- generic I2C helpers ---------------------------------------------------
static bool i2cReadN(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t n) {
  Wire.beginTransmission(addr); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)addr, (uint8_t)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}
static uint8_t i2cReg8(uint8_t addr, uint8_t reg) {
  uint8_t v = 0xFF; i2cReadN(addr, reg, &v, 1); return v;
}
static void i2cWrite8(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr); Wire.write(reg); Wire.write(val); Wire.endTransmission();
}

// ---- SHT31: temperature + humidity (single-shot, high repeatability) -------
static bool sht31Read(float* t, float* rh) {
  Wire.beginTransmission(OO_ADDR_SHT31);
  Wire.write(0x24); Wire.write(0x00);                 // no clock-stretch, high rep
  if (Wire.endTransmission() != 0) return false;
  delay(16);
  if (Wire.requestFrom((uint8_t)OO_ADDR_SHT31, (uint8_t)6) != 6) return false;
  uint8_t b[6]; for (int i = 0; i < 6; i++) b[i] = Wire.read();
  uint16_t rawT = ((uint16_t)b[0] << 8) | b[1];
  uint16_t rawH = ((uint16_t)b[3] << 8) | b[4];
  if (t)  *t  = -45.0f + 175.0f * rawT / 65535.0f;
  if (rh) *rh = 100.0f * rawH / 65535.0f;
  return true;
}

// ---- TMP117: precision temperature (16-bit, 7.8125 mC/LSB) ------------------
static bool tmp117Read(float* t) {
  uint8_t d[2];
  if (!i2cReadN(OO_ADDR_TMP117, 0x00, d, 2)) return false;   // temp result register
  int16_t raw = (int16_t)(((uint16_t)d[0] << 8) | d[1]);
  *t = raw * 0.0078125f;
  return true;
}

// ---- BMP280: pressure -> altitude (Bosch 64-bit compensation) --------------
static struct {
  uint16_t T1; int16_t T2, T3;
  uint16_t P1; int16_t P2, P3, P4, P5, P6, P7, P8, P9;
  bool ok;
} bmp = {0};

static uint16_t u16le(const uint8_t* c, int i) { return (uint16_t)(c[i] | (c[i+1] << 8)); }
static int16_t  s16le(const uint8_t* c, int i) { return (int16_t)u16le(c, i); }

static bool bmp280Init() {
  if (i2cReg8(OO_ADDR_BMP280, 0xD0) != 0x58) return false;   // chip id
  i2cWrite8(OO_ADDR_BMP280, 0xF4, 0x27);                     // temp x1, press x1, normal
  i2cWrite8(OO_ADDR_BMP280, 0xF5, 0xA0);                     // standby
  uint8_t c[24];
  if (!i2cReadN(OO_ADDR_BMP280, 0x88, c, 24)) return false;
  bmp.T1 = u16le(c,0);  bmp.T2 = s16le(c,2);  bmp.T3 = s16le(c,4);
  bmp.P1 = u16le(c,6);  bmp.P2 = s16le(c,8);  bmp.P3 = s16le(c,10);
  bmp.P4 = s16le(c,12); bmp.P5 = s16le(c,14); bmp.P6 = s16le(c,16);
  bmp.P7 = s16le(c,18); bmp.P8 = s16le(c,20); bmp.P9 = s16le(c,22);
  bmp.ok = true; return true;
}

static bool bmp280ReadAlt(float* alt) {
  if (!bmp.ok) return false;
  uint8_t d[6];
  if (!i2cReadN(OO_ADDR_BMP280, 0xF7, d, 6)) return false;
  int32_t adc_P = ((int32_t)d[0] << 12) | ((int32_t)d[1] << 4) | (d[2] >> 4);
  int32_t adc_T = ((int32_t)d[3] << 12) | ((int32_t)d[4] << 4) | (d[5] >> 4);

  int32_t v1 = ((((adc_T >> 3) - ((int32_t)bmp.T1 << 1))) * (int32_t)bmp.T2) >> 11;
  int32_t v2 = (((((adc_T >> 4) - (int32_t)bmp.T1) * ((adc_T >> 4) - (int32_t)bmp.T1)) >> 12) * (int32_t)bmp.T3) >> 14;
  int32_t t_fine = v1 + v2;

  int64_t p1 = (int64_t)t_fine - 128000;
  int64_t p2 = p1 * p1 * (int64_t)bmp.P6;
  p2 = p2 + ((p1 * (int64_t)bmp.P5) << 17);
  p2 = p2 + (((int64_t)bmp.P4) << 35);
  p1 = ((p1 * p1 * (int64_t)bmp.P3) >> 8) + ((p1 * (int64_t)bmp.P2) << 12);
  p1 = ((((int64_t)1 << 47) + p1)) * (int64_t)bmp.P1 >> 33;
  if (p1 == 0) return false;
  int64_t p = 1048576 - adc_P;
  p = (((p << 31) - p2) * 3125) / p1;
  p1 = ((int64_t)bmp.P9 * (p >> 13) * (p >> 13)) >> 25;
  p2 = ((int64_t)bmp.P8 * p) >> 19;
  p = ((p + p1 + p2) >> 8) + (((int64_t)bmp.P7) << 4);
  float pa = (float)p / 256.0f;                              // Pascals
  *alt = 44330.0f * (1.0f - powf(pa / 101325.0f, 0.1903f));
  return true;
}

// ---- ADXL345: |acceleration| - 1g (impact magnitude, g) --------------------
static bool adxlInit() {
  if (i2cReg8(OO_ADDR_ADXL345, 0x00) != 0xE5) return false;  // devid
  i2cWrite8(OO_ADDR_ADXL345, 0x31, 0x0B);                    // full-res, ±16 g
  i2cWrite8(OO_ADDR_ADXL345, 0x2D, 0x08);                    // measure
  return true;
}
static bool adxlReadG(float* g) {
  uint8_t d[6];
  if (!i2cReadN(OO_ADDR_ADXL345, 0x32, d, 6)) return false;
  int16_t x = (int16_t)(d[0] | (d[1] << 8));
  int16_t y = (int16_t)(d[2] | (d[3] << 8));
  int16_t z = (int16_t)(d[4] | (d[5] << 8));
  float gx = x * 0.0039f, gy = y * 0.0039f, gz = z * 0.0039f;   // 3.9 mg/LSB full-res
  *g = fabsf(sqrtf(gx*gx + gy*gy + gz*gz) - 1.0f);               // deviation from rest
  return true;
}

// ---- ADC: load (CT) and battery -------------------------------------------
static float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
static float adcLoadPct(uint8_t pin) {
  uint32_t mv = analogReadMilliVolts(pin);
  return clampf((float)mv / 3300.0f * 100.0f, 0, 100);
}
static float adcBattPct(uint8_t pin) {
  uint32_t mv = analogReadMilliVolts(pin);
  float vbat = (float)mv / 1000.0f * OO_ADC_BATT_DIV;
  return clampf((vbat - 3.0f) / (4.2f - 3.0f) * 100.0f, 0, 100);   // 1S Li-ion 3.0–4.2 V
}

// ---- digital input: door (debounced) --------------------------------------
static float diDoor(uint8_t pin) {
  int hi = 0;
  for (int i = 0; i < 5; i++) { hi += digitalRead(pin); delay(2); }
  bool high = hi >= 3;
  bool open = OO_DOOR_ACTIVE_LOW ? !high : high;
  return open ? 1.0f : 0.0f;
}

// ---- RS-485 Modbus-RTU master (read one holding register) ------------------
static HardwareSerial RS485(1);
static uint16_t crc16(const uint8_t* d, int n) {
  uint16_t c = 0xFFFF;
  for (int i = 0; i < n; i++) {
    c ^= d[i];
    for (int b = 0; b < 8; b++) c = (c & 1) ? (c >> 1) ^ 0xA001 : (c >> 1);
  }
  return c;
}
static bool modbusRead(uint16_t reg, uint16_t* out) {
  uint8_t f[8] = {OO_MODBUS_SLAVE, 0x03, (uint8_t)(reg >> 8), (uint8_t)reg, 0, 1, 0, 0};
  uint16_t c = crc16(f, 6); f[6] = c & 0xFF; f[7] = c >> 8;
  while (RS485.available()) RS485.read();                 // flush stale
  digitalWrite(OO_PIN_RS485_DE, HIGH); delayMicroseconds(60);
  RS485.write(f, 8); RS485.flush();
  digitalWrite(OO_PIN_RS485_DE, LOW);
  uint8_t r[7]; int got = 0; uint32_t t0 = millis();
  while (got < 7 && millis() - t0 < 250) { if (RS485.available()) r[got++] = RS485.read(); }
  if (got < 7 || r[0] != OO_MODBUS_SLAVE || r[1] != 0x03) return false;
  if ((uint16_t)(r[5] | (r[6] << 8)) != crc16(r, 5)) return false;
  *out = ((uint16_t)r[3] << 8) | r[4];
  return true;
}

// ---- CAN (TWAI) — sensors that publish frames (id -> latest value) ---------
struct CanEntry { uint32_t id; float val; bool valid; };
static CanEntry canCache[8];
static int      canN = 0;
static bool     canOk = false;

static bool canInit() {
  twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT(
      (gpio_num_t)OO_PIN_CAN_TX, (gpio_num_t)OO_PIN_CAN_RX, TWAI_MODE_NORMAL);
  twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS();   // OO_CAN_BITRATE_K
  twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&g, &t, &f) != ESP_OK) return false;
  return twai_start() == ESP_OK;
}

// Drain the rx queue into the per-id cache (non-blocking).
static void canPoll() {
  if (!canOk) return;
  twai_message_t m;
  while (twai_receive(&m, 0) == ESP_OK) {
    if (m.rtr || m.data_length_code < 2) continue;
    int16_t raw = (int16_t)(((uint16_t)m.data[0] << 8) | m.data[1]);   // BE int16
    float v = raw / 10.0f;
    int idx = -1;
    for (int i = 0; i < canN; i++) if (canCache[i].id == m.identifier) { idx = i; break; }
    if (idx < 0 && canN < (int)(sizeof(canCache) / sizeof(canCache[0]))) idx = canN++;
    if (idx >= 0) { canCache[idx].id = m.identifier; canCache[idx].val = v; canCache[idx].valid = true; }
  }
}

static bool canRead(uint32_t id, float* out) {
  canPoll();
  for (int i = 0; i < canN; i++)
    if (canCache[i].id == id && canCache[i].valid) { *out = canCache[i].val; return true; }
  return false;
}

void ooDriversInit() {
  Wire.begin(OO_I2C_SDA, OO_I2C_SCL);
  bmp280Init();
  adxlInit();
  pinMode(OO_PIN_DOOR_DI, INPUT_PULLUP);
  pinMode(OO_PIN_RS485_DE, OUTPUT); digitalWrite(OO_PIN_RS485_DE, LOW);
  RS485.begin(OO_MODBUS_BAUD, SERIAL_8N1, OO_PIN_RS485_RX, OO_PIN_RS485_TX);
  analogReadResolution(12);
  canOk = canInit();                                  // CAN sensors (eternity)
}

OoReading ooReadChannel(const OoChannel& ch) {
  float v = NAN; bool ok = false;
  switch (ch.bus) {
    case BUS_I2C_SHT31_T:  { float t, rh; ok = sht31Read(&t, &rh); v = t;  break; }
    case BUS_I2C_SHT31_RH: { float t, rh; ok = sht31Read(&t, &rh); v = rh; break; }
    case BUS_I2C_TMP117:   ok = tmp117Read(&v); break;
    case BUS_I2C_BMP280:   ok = bmp280ReadAlt(&v); break;
    case BUS_I2C_ADXL345:  ok = adxlReadG(&v); break;
    case BUS_ADC:          v = adcLoadPct((uint8_t)ch.arg); ok = true; break;
    case BUS_ADC_BATT:     v = adcBattPct((uint8_t)ch.arg); ok = true; break;
    case BUS_DI:           v = diDoor((uint8_t)ch.arg); ok = true; break;
    case BUS_MODBUS:       { uint16_t r; ok = modbusRead(ch.arg, &r); if (ok) v = r / 10.0f; break; }
    case BUS_CAN:          ok = canRead(ch.arg, &v); break;
    default:               ok = false; break;
  }
  if (ok && !isnan(v)) return { v, "good" };
#if OO_SIM_FALLBACK
  return { ooSimRead(ch), "sim" };
#else
  return { NAN, "error" };
#endif
}

#else  // ---- OO_USE_REAL_SENSORS == 0 : pure simulation --------------------

void ooDriversInit() {}
OoReading ooReadChannel(const OoChannel& ch) { return { ooSimRead(ch), "good" }; }

#endif
