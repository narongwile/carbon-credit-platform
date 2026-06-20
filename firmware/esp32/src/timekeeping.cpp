#include "timekeeping.h"
#include "config.h"
#include "transport.h"          // ooCellTime() — modem clock source
#include <Wire.h>
#include <time.h>
#include <sys/time.h>

static bool        gRtcPresent = false;
static const char* gSrc        = "uptime";
static uint32_t    gLastNtpCheck = 0;
static bool        gNtpLocked  = false;

// ---- DS3231 (minimal Wire driver, no external lib) -------------------------
static uint8_t bcd2dec(uint8_t b) { return (uint8_t)((b >> 4) * 10 + (b & 0x0F)); }
static uint8_t dec2bcd(uint8_t d) { return (uint8_t)(((d / 10) << 4) | (d % 10)); }

static bool ds3231Read(struct tm& t) {
  Wire.beginTransmission(OO_DS3231_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(OO_DS3231_ADDR, 7) != 7) return false;
  uint8_t ss = Wire.read(), mm = Wire.read(), hh = Wire.read();
  Wire.read();                                   // day-of-week (unused)
  uint8_t dd = Wire.read(), mo = Wire.read(), yy = Wire.read();
  t.tm_sec  = bcd2dec(ss & 0x7F);
  t.tm_min  = bcd2dec(mm & 0x7F);
  t.tm_hour = bcd2dec(hh & 0x3F);                // 24h
  t.tm_mday = bcd2dec(dd & 0x3F);
  t.tm_mon  = bcd2dec(mo & 0x1F) - 1;
  t.tm_year = bcd2dec(yy) + 100;                 // years since 1900 (20xx)
  t.tm_isdst = 0;
  return true;
}

static void ds3231Write(time_t epoch) {
  struct tm t; gmtime_r(&epoch, &t);
  Wire.beginTransmission(OO_DS3231_ADDR);
  Wire.write(0x00);
  Wire.write(dec2bcd(t.tm_sec));
  Wire.write(dec2bcd(t.tm_min));
  Wire.write(dec2bcd(t.tm_hour));
  Wire.write(dec2bcd(t.tm_wday ? t.tm_wday : 7));
  Wire.write(dec2bcd(t.tm_mday));
  Wire.write(dec2bcd(t.tm_mon + 1));
  Wire.write(dec2bcd((uint8_t)(t.tm_year - 100)));
  Wire.endTransmission();
}

static void setSystemTime(time_t epoch) {
  struct timeval tv{ .tv_sec = epoch, .tv_usec = 0 };
  settimeofday(&tv, nullptr);
}

void ooTimeInit() {
  setenv("TZ", "UTC0", 1); tzset();                 // mktime/gmtime operate in UTC
#if OO_RTC_ENABLE
  Wire.begin(OO_I2C_SDA, OO_I2C_SCL);
  struct tm t{};
  if (ds3231Read(t)) {
    time_t e = mktime(&t);                        // tm is UTC -> use timegm semantics
    // mktime assumes local time; we keep TZ=UTC (configTime(0,0,...)) so it matches.
    if (e > 1700000000) { setSystemTime(e); gRtcPresent = true; gSrc = "rtc"; }
    else gRtcPresent = true;                       // present but unset
  }
#endif
  configTime(0, 0, OO_NTP_SERVER1, OO_NTP_SERVER2); // UTC, start SNTP (spec §10.1)
}

void ooTimeTick() {
  if (gNtpLocked) return;
  if (millis() - gLastNtpCheck < 1000) return;
  gLastNtpCheck = millis();

  time_t now = time(nullptr);
  if (now > 1700000000) {
    // SNTP (Wi-Fi) has stepped the clock. Promote source and discipline the RTC.
    gSrc = "ntp";
    gNtpLocked = true;
#if OO_RTC_ENABLE
    if (gRtcPresent) ds3231Write(now);
#endif
    return;
  }
  // No NTP (e.g. on 4G, where UDP/NTP is blocked): take the time from the modem.
  time_t cell;
  if (ooCellTime(&cell)) {
    setSystemTime(cell);
    gSrc = "cell";
    gNtpLocked = true;                              // stop polling; modem clock is authoritative
#if OO_RTC_ENABLE
    if (gRtcPresent) ds3231Write(cell);
#endif
  }
}

uint64_t ooEpochMs() {
  time_t now = time(nullptr);
  if (now > 1700000000) return (uint64_t)now * 1000ULL + (millis() % 1000);
  return millis();                                 // pre-clock: uptime ms
}

const char* ooTimeSrc()  { return gSrc; }
bool        ooRtcPresent() { return gRtcPresent; }
