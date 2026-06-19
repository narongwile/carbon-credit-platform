// ===========================================================================
//  ESP32-S3 — ONEOPS / ETERNITY unified PRODUCTION firmware.
//  One image, three product profiles (spec §12). FreeRTOS task split (§14):
//    SensorTask  — sample active channels + edge-alarm eval -> egress queue
//    MqttTask    — sole MQTT publisher: drains egress (alarm before telemetry),
//                  QoS 1 + LWT/birth, mTLS, downlink (config/cmd/ota)
//    OtaTask     — A/B HTTPS OTA with rollback (ota.cpp, §24)
//    Watchdog    — per-task heartbeat flags -> targeted reset (§14)
//  Audit time from NTP/DS3231 with time_src (§10.1). See README for the parts
//  that still require hardware/CI validation.
// ===========================================================================
#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "oneops.h"
#include "identity.h"
#include "timekeeping.h"
#include "product_profile.h"
#include "drivers.h"
#include "net_mqtt.h"
#include "ota.h"

static const OoProfile* profile = nullptr;
static uint32_t bootMs = 0;

// ---- per-task heartbeat flags for the software watchdog (spec §14) ---------
enum { HB_SENSOR = 0, HB_MQTT = 1, HB_COUNT };
static volatile uint32_t gHb[HB_COUNT] = {0};

// ---- telemetry builders ----------------------------------------------------
// Returns the read value (NaN-safe) so the caller can run the edge alarm.
static float enqueueReading(const OoChannel& ch, const OoReading& r) {
  JsonDocument d;
  d["ts"] = ooEpochMs(); d["device_id"] = ooId().device; d["product"] = ooId().product;
  d["sid"] = ch.sid; d["channel"] = ch.channel; d["unit"] = ch.unit;
  if (isnan(r.value)) d["value"] = nullptr; else d["value"] = r.value;
  d["quality"] = r.quality;                                        // good | sim | error (§16)
  char buf[256]; size_t n = serializeJson(d, buf);
  char suffix[64]; snprintf(suffix, sizeof(suffix), "sensors/%s/raw", ch.sid);
  ooEnqueue(suffix, buf, n, /*qos*/1, false, /*prio*/0);           // spec §6
  return r.value;
}

static void enqueueConsolidated() {
  JsonDocument d;
  d["nodeId"] = ooId().device; d["ts"] = ooEpochMs();
  JsonObject vals = d["values"].to<JsonObject>();
  for (size_t i = 0; i < profile->count; i++) {
    OoReading r = ooReadChannel(profile->channels[i]);
    if (!isnan(r.value)) vals[profile->channels[i].channel] = r.value;
  }
  char buf[480]; size_t n = serializeJson(d, buf);
  char t[64];
  snprintf(t, sizeof(t), "%s/%s", strlen(OO_TOPIC_ROOT) ? OO_TOPIC_ROOT : "telemetry", ooId().device.c_str());
  ooEnqueue(t, buf, n, 1, false, 0, /*absolute=*/true);
}

static void enqueueEdgeAlarm(const OoChannel& ch, float v, OoSeverity sev) {
  JsonDocument d;
  d["ts"] = ooEpochMs(); d["device_id"] = ooId().device; d["sid"] = ch.sid;
  d["channel"] = ch.channel; d["value"] = v;
  d["severity"] = ooSeverityName(sev); d["edge"] = true;          // hint only (§9)
  char buf[200]; size_t n = serializeJson(d, buf);
  char suffix[64]; snprintf(suffix, sizeof(suffix), "alarm/%s", ch.sid);
  ooEnqueue(suffix, buf, n, /*qos*/1, false, /*prio*/1);          // high priority
}

static void enqueueHeartbeat() {
  JsonDocument d;
  d["ts"] = ooEpochMs(); d["device_id"] = ooId().device; d["product"] = ooId().product;
  d["rssi"] = ooRssi(); d["batt"] = 100; d["uptime"] = (millis() - bootMs) / 1000;
  d["fw"] = ooId().fw; d["heap"] = ESP.getFreeHeap();
  d["time_src"] = ooTimeSrc(); d["transport"] = ooTransport();
  char buf[256]; size_t n = serializeJson(d, buf);
  ooEnqueue("heartbeat", buf, n, /*qos*/0, false, /*prio*/0);     // spec §3
}

// ---- tasks -----------------------------------------------------------------
static void sensorTask(void*) {
  uint32_t lastSample = 0, lastBeat = 0;
  for (;;) {
    uint32_t now = millis();
    if (now - lastSample >= ooCfgSampleMs()) {
      lastSample = now;
#if OO_NODERED_COMPAT
      enqueueConsolidated();
#else
      for (size_t i = 0; i < profile->count; i++) {
        OoReading r = ooReadChannel(profile->channels[i]);          // real bus read (§6)
        float v = enqueueReading(profile->channels[i], r);
        if (isnan(v)) continue;                                     // sensor fault -> no alarm
        OoSeverity sev = ooEvalSeverity(profile->channels[i], v);
        if (sev >= OO_WARNING) enqueueEdgeAlarm(profile->channels[i], v, sev);  // §8/§9
      }
#endif
    }
    if (now - lastBeat >= OO_HEARTBEAT_MS) { lastBeat = now; enqueueHeartbeat(); }
    gHb[HB_SENSOR]++;
    ooTimeTick();                                  // discipline clock / RTC (§10.1)
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

static void mqttTask(void*) {
  bool everConnected = false;
  for (;;) {
    ooMqttService();
    if (ooMqttConnected() && !everConnected) {     // first steady state reached
      everConnected = true;
      ooOtaConfirmHealthy();                        // cancel A/B rollback (§24)
      digitalWrite(OO_LED_GREEN, HIGH);
    }
    if (!ooMqttConnected()) digitalWrite(OO_LED_GREEN, LOW);
    gHb[HB_MQTT]++;
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

static void watchdogTask(void*) {
  uint32_t prev[HB_COUNT] = {0};
  uint32_t stalls[HB_COUNT] = {0};
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(1000));
    for (int i = 0; i < HB_COUNT; i++) {
      if (gHb[i] == prev[i]) {
        if (++stalls[i] >= OO_WDT_TIMEOUT_S) {      // task stalled (spec §14)
          digitalWrite(OO_LED_RED, HIGH);
          delay(50);
          ESP.restart();                            // targeted reset
        }
      } else stalls[i] = 0;
      prev[i] = gHb[i];
    }
  }
}

// ---- lifecycle -------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(150);
  bootMs = millis();
  randomSeed(esp_random());
  pinMode(OO_LED_GREEN, OUTPUT); pinMode(OO_LED_RED, OUTPUT);

  ooIdentityInit();                                 // identity + certs (§2/§13)
  ooOtaInit();                                      // arm/confirm A/B rollback (§24)
  ooTimeInit();                                     // NTP + DS3231 + time_src (§10.1)

  profile = &ooGetProfile(ooId().product.c_str());
  ooDriversInit();                                  // real sensor buses (drivers.cpp)
  Serial.printf("\n[boot] %s fw %s product=%s channels=%u provisioned=%d rtc=%d\n",
                ooId().device.c_str(), ooId().fw.c_str(), ooId().product.c_str(),
                (unsigned)profile->count, ooId().provisioned, ooRtcPresent());

  gEgressHi = xQueueCreate(OO_EGRESS_DEPTH, sizeof(EgressMsg));
  gEgressLo = xQueueCreate(OO_EGRESS_DEPTH, sizeof(EgressMsg));

  ooNetInit();
  ooOtaTaskStart();

  xTaskCreatePinnedToCore(sensorTask,   "SensorTask", OO_STACK_SENSOR, nullptr, 5, nullptr, 1);
  xTaskCreatePinnedToCore(mqttTask,     "MqttTask",   OO_STACK_MQTT,   nullptr, 5, nullptr, 0);
  xTaskCreatePinnedToCore(watchdogTask, "Watchdog",   OO_STACK_WDT,    nullptr, 7, nullptr, 0);
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));   // all work runs in tasks
}
