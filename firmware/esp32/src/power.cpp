#include "power.h"
#include "config.h"
#include "esp_sleep.h"

void ooPowerInit() { analogReadResolution(12); }

float ooBatteryPct() {
  uint32_t mv = analogReadMilliVolts(OO_PIN_BATT_ADC);
  float vbat = (float)mv / 1000.0f * OO_ADC_BATT_DIV;          // 1S Li-ion 3.0–4.2 V
  float pct = (vbat - 3.0f) / (4.2f - 3.0f) * 100.0f;
  return pct < 0 ? 0 : (pct > 100 ? 100 : pct);
}

uint32_t ooPowerSampleMs(uint32_t baseMs, OoTransit state, float battPct) {
#if OO_LOWPOWER
  uint32_t ms = baseMs;
  if (state == TRANSIT_STORED)  ms = baseMs * 4;                // stationary: slow down
  else if (state == TRANSIT_ARRIVED) ms = baseMs * 2;
  if (battPct < 20.0f)          ms *= 2;                        // conserve on low battery
  return ms;
#else
  (void)state; (void)battPct; return baseMs;
#endif
}

void ooEnterDeepSleep(uint32_t seconds) {
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
#if OO_DEEPSLEEP_IMU_WAKE
  // Wake immediately on an ADXL345 activity (impact) interrupt — INT1 active-high.
  esp_sleep_enable_ext0_wakeup((gpio_num_t)OO_PIN_IMU_INT, 1);
#endif
  esp_deep_sleep_start();                                       // resets on wake; RTC mem persists
}

bool ooWokeOnImpact() {
  return esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0;
}
