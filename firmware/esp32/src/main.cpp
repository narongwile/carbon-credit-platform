// ===========================================================================
//  ESP32-S3 — ONEOPS / ETERNITY unified PRODUCTION firmware.
//  One image, three product profiles (spec §12). FreeRTOS task split (§14):
//    SensorTask  — sample active channels, edge-alarm debounce, store-or-send
//    MqttTask    — sole MQTT publisher: drains egress, replays the offline store
//    OtaTask     — A/B HTTPS OTA with rollback (ota.cpp, §24)
//    Watchdog    — per-task heartbeat flags -> targeted reset (§14)
//  Per-product extras: bloodbox transit FSM + GPS + power policy; eternity DGA
//  rate-of-rise; carbonbox door-dwell debounce. See README for HW validation.
// ===========================================================================
#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "oneops.h"
#include "identity.h"
#include "timekeeping.h"
#include "product_profile.h"
#include "drivers.h"
#include "alarm.h"
#include "store.h"
#include "trend.h"
#include "transport.h"
#include "gps.h"
#include "transit.h"
#include "power.h"
#include "net_mqtt.h"
#include "ota.h"

static const OoProfile* profile = nullptr;
static uint32_t  bootMs = 0;
static bool      isBlood = false, isEternity = false;
static OoTransit transitState = TRANSIT_IDLE;
static OoTr      curTransport = TR_WIFI;
#define DGA_KEY 0

enum { HB_SENSOR = 0, HB_MQTT = 1, HB_COUNT };
static volatile uint32_t gHb[HB_COUNT] = {0};

// Publish when connected, else persist to the offline store (spec §14).
static void publishOrStore(const char* suffix, const char* json, size_t n, uint8_t qos, uint8_t prio) {
  if (ooMqttConnected()) ooEnqueue(suffix, json, n, qos, false, prio);
  else                   ooStoreAppend(suffix, json, n);
}

// ---- telemetry builders ----------------------------------------------------
static void buildReading(const OoChannel& ch, const OoReading& r) {
  JsonDocument d;
  d["ts"] = ooEpochMs(); d["device_id"] = ooId().device; d["product"] = ooId().product;
  d["sid"] = ch.sid; d["channel"] = ch.channel; d["unit"] = ch.unit;
  if (isnan(r.value)) d["value"] = nullptr; else d["value"] = r.value;
  d["quality"] = r.quality;                                       // good | sim | error (§16)
  char buf[256]; size_t n = serializeJson(d, buf);
  char suffix[64]; snprintf(suffix, sizeof(suffix), "sensors/%s/raw", ch.sid);
  publishOrStore(suffix, buf, n, /*qos*/1, /*prio*/0);            // §6
}

static void buildEdgeAlarm(const OoChannel& ch, float v, OoSeverity sev) {
  JsonDocument d;
  d["ts"] = ooEpochMs(); d["device_id"] = ooId().device; d["sid"] = ch.sid;
  d["channel"] = ch.channel; d["value"] = v;
  d["severity"] = ooSeverityName(sev); d["edge"] = true;          // hint only (§9)
  char buf[200]; size_t n = serializeJson(d, buf);
  char suffix[64]; snprintf(suffix, sizeof(suffix), "alarm/%s", ch.sid);
  publishOrStore(suffix, buf, n, /*qos*/1, /*prio*/1);
}

static void buildHeartbeat() {
  JsonDocument d;
  d["ts"] = ooEpochMs(); d["device_id"] = ooId().device; d["product"] = ooId().product;
  d["rssi"] = ooRssi(); d["uptime"] = (millis() - bootMs) / 1000;
  d["fw"] = ooId().fw; d["heap"] = ESP.getFreeHeap();
  d["time_src"] = ooTimeSrc(); d["transport"] = ooTransportName(curTransport);
  d["batt"] = isBlood ? (int)ooBatteryPct() : 100;                // real battery for bloodbox
  if (isBlood) {
    d["transit"] = ooTransitName(transitState);
    if (ooGpsFix()) { d["lat"] = ooGpsLat(); d["lng"] = ooGpsLng(); }
  }
  if (isEternity) { float r = ooTrendPerHour(DGA_KEY); if (!isnan(r)) d["dga_h2_rate"] = r; }
  char buf[320]; size_t n = serializeJson(d, buf);
  if (ooMqttConnected()) ooEnqueue("heartbeat", buf, n, /*qos*/0, false, /*prio*/0);  // §3 (drop if offline)
}

// ---- tasks -----------------------------------------------------------------
static void sensorTask(void*) {
  uint32_t lastSample = 0, lastBeat = 0;
  for (;;) {
    uint32_t now = millis();
    uint64_t epoch = ooEpochMs();
    if (isBlood) ooGpsTick();
    // ให้มันกวาดข้อมูลจาก CAN Bus ทิ้งตลอดเวลา (ทุกๆ 50ms)
    // ถ้ามี Driver CAN คืนค่าออกมาเป็นฟังก์ชันให้เรียกใช้ เช่น ooCanPoll()
    #if defined(isEternity) // หรือเช็ค profile
       ooCanPoll(); 
    #endif

    uint32_t period = isBlood ? ooPowerSampleMs(ooCfgSampleMs(), transitState, ooBatteryPct())
                              : ooCfgSampleMs();
    if (now - lastSample >= period) {
      lastSample = now;
      float impactG = 0;
      for (size_t i = 0; i < profile->count; i++) {
        const OoChannel& ch = profile->channels[i];
        OoReading r = ooReadChannel(ch);                          // real bus read (§6)
        buildReading(ch, r);
        if (isnan(r.value)) continue;                             // sensor fault -> no alarm

        if (isEternity && strcmp(ch.channel, "dga_h2_ppm") == 0) ooTrendPush(DGA_KEY, epoch, r.value);
        if (strcmp(ch.channel, "impact_g") == 0) impactG = r.value;

        OoAlarmOut a = ooAlarmEval(i, ch, r.value, epoch);        // debounced edge alarm (§8/§9)
        if (a.fire) buildEdgeAlarm(ch, r.value, a.sev);
      }
      if (isBlood) transitState = ooTransitTick(impactG, ooGpsSpeedKnots(), epoch);
    }
    if (now - lastBeat >= OO_HEARTBEAT_MS) { lastBeat = now; buildHeartbeat(); }
    gHb[HB_SENSOR]++;
    ooTimeTick();
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

static void mqttTask(void*) {
  bool everConnected = false, wasConnected = false;
  for (;;) {
    ooMqttService();
    curTransport = ooTransportSelect(millis());                  // hysteresis (§21)
    bool up = ooMqttConnected();
    if (up && !everConnected) { everConnected = true; ooOtaConfirmHealthy(); }  // §24
    if (up && !wasConnected) ooStoreReplay();                    // flush offline buffer (§14)
    digitalWrite(OO_LED_GREEN, up ? HIGH : LOW);
    wasConnected = up;
    gHb[HB_MQTT]++;
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

static void watchdogTask(void*) {
  uint32_t prev[HB_COUNT] = {0}, stalls[HB_COUNT] = {0};
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(1000));
    for (int i = 0; i < HB_COUNT; i++) {
      if (gHb[i] == prev[i]) {
        if (++stalls[i] >= OO_WDT_TIMEOUT_S) { digitalWrite(OO_LED_RED, HIGH); delay(50); ESP.restart(); }
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

  ooIdentityInit();                                 // identity + mTLS certs (§2/§13)
  ooOtaInit();                                      // arm/confirm A/B rollback (§24)
  ooTimeInit();                                     // NTP + DS3231 + time_src (§10.1)

  profile = &ooGetProfile(ooId().product.c_str());
  isBlood    = strcmp(ooId().product.c_str(), "bloodbox") == 0;
  isEternity = strcmp(ooId().product.c_str(), "eternity") == 0;

  ooDriversInit();                                  // real sensor buses (drivers.cpp)
  ooAlarmInit(profile);                             // edge-alarm state machine (§8/§9)
  ooStoreInit();                                    // offline store-and-forward (§14)
  ooPowerInit();
  ooTransportInit();
  if (isBlood) { ooGpsInit(); ooTransitInit(); }    // transit position + FSM

  Serial.printf("\n[boot] %s fw %s product=%s channels=%u provisioned=%d rtc=%d store=%uB\n",
                ooId().device.c_str(), ooId().fw.c_str(), ooId().product.c_str(),
                (unsigned)profile->count, ooId().provisioned, ooRtcPresent(), (unsigned)ooStorePending());

  gEgressHi = xQueueCreate(OO_EGRESS_DEPTH, sizeof(EgressMsg));
  gEgressLo = xQueueCreate(OO_EGRESS_DEPTH, sizeof(EgressMsg));

  ooNetInit();
  ooOtaTaskStart();

  xTaskCreatePinnedToCore(sensorTask,   "SensorTask", OO_STACK_SENSOR, nullptr, 5, nullptr, 1);
  xTaskCreatePinnedToCore(mqttTask,     "MqttTask",   OO_STACK_MQTT,   nullptr, 5, nullptr, 0);
  xTaskCreatePinnedToCore(watchdogTask, "Watchdog",   OO_STACK_WDT,    nullptr, 7, nullptr, 0);
}

void loop() { vTaskDelay(pdMS_TO_TICKS(1000)); }
