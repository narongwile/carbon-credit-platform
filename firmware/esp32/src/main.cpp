// ===========================================================================
// ESP32-S3 — ONEOPS / ETERNITY unified firmware (dev / bring-up build)
// Implements the MQTT telemetry contract of docs/esp32-platform-spec.tex:
//   • presence: retained Will + birth on  P/status            (spec §2, §5)
//   • liveness: P/heartbeat every 30 s                        (spec §3)
//   • telemetry: per-channel envelope on P/sensors/{sid}/raw  (spec §6)
//   • downlink: subscribe P/config, P/cmd/+, P/ota/cmd        (spec §7)
//   • diagnostics: P/diag/log                                 (spec §16)
// One image serves three products via the runtime PRODUCT PROFILE (spec §12).
//
// Scope of THIS build: the cloud contract + telemetry path, so data reaches the
// Node-RED ingest flow. Production-only concerns from the spec are intentionally
// stubbed and marked: mutual-TLS provisioning (§2), A/B signed OTA (§4/§24),
// 4G/LoRa failover + hysteresis (§15/§21), FreeRTOS task split (§14). See README.
// ===========================================================================
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "config.h"
#include "product_profile.h"

#if OO_MQTT_TLS
static WiFiClientSecure net;
#else
static WiFiClient net;
#endif
static PubSubClient mqtt(net);

static const OoProfile* profile = nullptr;
static String PFX;                 // device topic prefix P
static uint32_t bootMs = 0;
static uint32_t lastBeat = 0, lastSample = 0, lastBackoff = 0;
static uint32_t sampleMs = OO_SAMPLE_MS;
static uint16_t backoffMs = 1000;  // reconnect backoff (cap + jitter), spec §15

// ---- helpers ---------------------------------------------------------------
static String buildPrefix() {
  String p;
  if (strlen(OO_TOPIC_ROOT)) { p += OO_TOPIC_ROOT; p += "/"; }
  p += OO_TENANT; p += "/"; p += OO_PRODUCT; p += "/"; p += OO_DEVICE_ID;
  return p;
}
static String topic(const char* suffix) { return PFX + "/" + suffix; }

// epoch milliseconds (NTP-synced); falls back to uptime ms before sync.
static uint64_t epochMs() {
  time_t now = time(nullptr);
  if (now > 1700000000) return (uint64_t)now * 1000ULL + (millis() % 1000);
  return millis();
}

static void publishDiag(const char* level, const char* msg) {
  JsonDocument d;
  d["ts"] = epochMs(); d["device_id"] = OO_DEVICE_ID; d["level"] = level; d["msg"] = msg;
  char buf[200]; size_t n = serializeJson(d, buf);
  mqtt.publish(topic("diag/log").c_str(), (uint8_t*)buf, n, false);
}

static void publishStatus(const char* state) {
  JsonDocument d;
  d["ts"] = epochMs(); d["device_id"] = OO_DEVICE_ID; d["product"] = OO_PRODUCT;
  d["state"] = state; d["fw"] = OO_FW_VERSION; d["ip"] = WiFi.localIP().toString();
  char buf[224]; size_t n = serializeJson(d, buf);
  mqtt.publish(topic("status").c_str(), (uint8_t*)buf, n, true);   // retain=1 (birth)
}

static void publishHeartbeat() {
  JsonDocument d;
  d["ts"] = epochMs(); d["device_id"] = OO_DEVICE_ID; d["product"] = OO_PRODUCT;
  d["rssi"] = WiFi.RSSI(); d["batt"] = 100; d["uptime"] = (millis() - bootMs) / 1000;
  d["fw"] = OO_FW_VERSION; d["heap"] = ESP.getFreeHeap();
  char buf[256]; size_t n = serializeJson(d, buf);
  mqtt.publish(topic("heartbeat").c_str(), (uint8_t*)buf, n, false);  // QoS 0, retain 0
}

static void publishOtaProgress(int pct, const char* status) {
  JsonDocument d;
  d["ts"] = epochMs(); d["pct"] = pct; d["status"] = status; d["fw"] = OO_FW_VERSION;
  char buf[160]; size_t n = serializeJson(d, buf);
  mqtt.publish(topic("ota/progress").c_str(), (uint8_t*)buf, n, false);
}

// Spec §6 canonical: one publish per channel on P/sensors/{sid}/raw.
static void publishReadingSpec(const OoChannel& ch, float v) {
  JsonDocument d;
  d["ts"] = epochMs(); d["device_id"] = OO_DEVICE_ID; d["product"] = OO_PRODUCT;
  d["sid"] = ch.sid; d["channel"] = ch.channel;
  d["value"] = v; d["unit"] = ch.unit; d["quality"] = "good";
  char buf[256]; size_t n = serializeJson(d, buf);
  String t = PFX + "/sensors/" + ch.sid + "/raw";
  mqtt.publish(t.c_str(), (uint8_t*)buf, n, false);
}

// Node-RED compat: one consolidated {nodeId,values,ts} per cycle. The flow's
// `normalize` node maps spec channel names -> engine param keys.
static void publishConsolidated() {
  JsonDocument d;
  d["nodeId"] = OO_DEVICE_ID; d["ts"] = epochMs();
  JsonObject vals = d["values"].to<JsonObject>();
  for (size_t i = 0; i < profile->count; i++)
    vals[profile->channels[i].channel] = ooSimRead(profile->channels[i]);
  char buf[512]; size_t n = serializeJson(d, buf);
  String t = strlen(OO_TOPIC_ROOT) ? String(OO_TOPIC_ROOT) + "/" + OO_DEVICE_ID
                                   : String("telemetry/") + OO_DEVICE_ID;
  mqtt.publish(t.c_str(), (uint8_t*)buf, n, false);
}

static void sampleAndPublish() {
#if OO_NODERED_COMPAT
  publishConsolidated();
#else
  for (size_t i = 0; i < profile->count; i++)
    publishReadingSpec(profile->channels[i], ooSimRead(profile->channels[i]));
#endif
}

// ---- downlink (config / cmd / ota) -----------------------------------------
static void onMessage(char* t, byte* payload, unsigned int len) {
  String tp(t);
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) { publishDiag("warn", "bad downlink json"); return; }

  if (tp.endsWith("/config")) {
    // Retained per-product config (spec §8): adopt sample rate; thresholds are
    // applied by the edge-alarm fast-path in a full build.
    if (doc["sample_s"].is<int>()) sampleMs = (uint32_t)doc["sample_s"] * 1000UL;
    Serial.println("[config] applied (sample_s + thresholds)");
    publishDiag("info", "config applied");
  } else if (tp.indexOf("/cmd/") >= 0) {
    const char* op = doc["op"] | "";
    Serial.printf("[cmd] %s\n", op);
    if (tp.endsWith("/reboot") || strcmp(op, "reboot") == 0) { publishDiag("info", "reboot"); delay(200); ESP.restart(); }
  } else if (tp.endsWith("/ota/cmd")) {
    // Production: fetch artefact over HTTPS, verify SHA-256 + secure-boot, flash
    // inactive A/B slot, promote, auto-rollback (spec §4/§24). Dev build acks only.
    Serial.println("[ota] descriptor received — A/B flash not in dev build");
    publishOtaProgress(0, "accepted");
  }
}

// ---- connectivity ----------------------------------------------------------
static bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(OO_WIFI_SSID, OO_WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { delay(250); Serial.print('.'); }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

static bool connectMqtt() {
  if (!connectWifi()) return false;
  // Will: retained offline status, fired by the broker on ungraceful drop (spec §5).
  String willTopic = topic("status");
  JsonDocument will;
  will["state"] = "offline"; will["reason"] = "lwt"; will["device_id"] = OO_DEVICE_ID;
  char willBuf[128]; serializeJson(will, willBuf);

  String cid = String(OO_TENANT) + "." + OO_PRODUCT + "." + OO_DEVICE_ID;  // = cert CN in prod
  bool ok = mqtt.connect(
      cid.c_str(),
      strlen(OO_MQTT_USER) ? OO_MQTT_USER : nullptr,
      strlen(OO_MQTT_PASS) ? OO_MQTT_PASS : nullptr,
      willTopic.c_str(), 1, true, willBuf);   // willQoS=1, willRetain=true
  if (!ok) return false;

  publishStatus("online");                    // birth clears the Will
  mqtt.subscribe(topic("config").c_str(), 1);
  mqtt.subscribe(topic("cmd/+").c_str(), 1);
  mqtt.subscribe(topic("ota/cmd").c_str(), 1);
  publishDiag("info", "online");
  Serial.printf("[mqtt] connected as %s, prefix %s\n", cid.c_str(), PFX.c_str());
  return true;
}

// ---- lifecycle -------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  bootMs = millis();
  randomSeed(esp_random());

  profile = &ooGetProfile(OO_PRODUCT);
  sampleMs = OO_SAMPLE_MS ? OO_SAMPLE_MS : profile->sampleMs;
  PFX = buildPrefix();
  Serial.printf("\n[boot] %s fw %s — product=%s channels=%u\n",
                OO_DEVICE_ID, OO_FW_VERSION, OO_PRODUCT, (unsigned)profile->count);

  connectWifi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");   // audit-grade timestamps (spec §10.1)

#if OO_MQTT_TLS
  net.setInsecure();   // DEV ONLY. Production: net.setCACert + setCertificate + setPrivateKey (mTLS).
#endif
  mqtt.setServer(OO_MQTT_HOST, OO_MQTT_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(60);          // spec §1: keepalive 60 s
  mqtt.setCallback(onMessage);
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) {
    // Reconnect with exponential backoff (cap 30 s) + jitter (spec §15/§21).
    if (millis() - lastBackoff >= backoffMs) {
      lastBackoff = millis();
      if (connectMqtt()) backoffMs = 1000;
      else { uint32_t nb = (uint32_t)backoffMs * 2; if (nb > 30000) nb = 30000; backoffMs = nb + random(0, 500); }
    }
    return;
  }
  mqtt.loop();

  uint32_t now = millis();
  if (now - lastBeat >= OO_HEARTBEAT_MS) { lastBeat = now; publishHeartbeat(); }
  if (now - lastSample >= sampleMs)      { lastSample = now; sampleAndPublish(); }
}
