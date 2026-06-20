#include "net_mqtt.h"
#include "config.h"
#include "oneops.h"
#include "identity.h"
#include "timekeeping.h"
#include "ota.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <MQTT.h>            // 256dpi/arduino-mqtt: QoS 1 + LWT
#include <ArduinoJson.h>

#if OO_MQTT_TLS
static WiFiClientSecure net;
#else
static WiFiClient net;
#endif
static MQTTClient mqtt(1024);

static uint32_t backoffMs   = 1000;     // reconnect backoff (cap + jitter, §15)
static uint32_t lastAttempt = 0;
static String   PFX;                    // device prefix P

static String full(const char* suffix) { return PFX + "/" + suffix; }

// ---- downlink (config / cmd / ota) — runs in MQTT task context -------------
static void onMessage(String& topic, String& payload) {
  JsonDocument d;
  if (deserializeJson(d, payload)) return;

  if (topic.endsWith("/config")) {
    if (d["sample_s"].is<int>()) ooCfgSetSampleMs(d["sample_s"].as<uint32_t>() * 1000UL);
    if (d["cfg_v"].is<int>())    ooCfgSetVersion(d["cfg_v"].as<uint32_t>());
    char m[48]; size_t n = snprintf(m, sizeof(m), "{\"applied\":\"config\"}");
    ooEnqueue("diag/log", m, n, 1, false, 1);
  } else if (topic.indexOf("/cmd/") >= 0) {
    const char* op = d["op"] | "";
    if (topic.endsWith("/reboot") || strcmp(op, "reboot") == 0) {
      delay(150); ESP.restart();
    }
  } else if (topic.endsWith("/ota/cmd")) {
    ooOtaSubmit(payload.c_str(), payload.length());   // handled by OtaTask (§24)
  }
}

void ooNetInit() {
  PFX = ooId().topicPrefix;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

#if OO_MQTT_TLS
  const OoCerts& c = ooCerts();
  if (c.ca.length()) {
    net.setCACert(c.ca.c_str());                        // verify the broker cert (production)
  } else {
#if OO_TLS_ALLOW_INSECURE
    Serial.println("[mqtt] WARNING: no CA pinned — TLS server validation DISABLED (dev only)");
    net.setInsecure();
#else
    Serial.println("[mqtt] ERROR: TLS enabled but no CA provisioned — refusing to connect");
    return;                                             // fail closed: never MITM-able in production
#endif
  }
  if (c.haveClient) {                                    // mutual TLS (spec §2)
    net.setCertificate(c.clientCert.c_str());
    net.setPrivateKey(c.clientKey.c_str());
  }
#endif

  mqtt.begin(OO_MQTT_HOST, OO_MQTT_PORT, net);
  mqtt.setOptions(60, /*cleanSession=*/false, 5000);     // keepalive 60s, persistent session (§1)
  mqtt.onMessage(onMessage);

  // Last Will: retained offline status, fired by the broker on ungraceful drop.
  static String willTopic = full("status");
  static char willBuf[128];
  JsonDocument w; w["state"] = "offline"; w["reason"] = "lwt"; w["device_id"] = ooId().device;
  serializeJson(w, willBuf, sizeof(willBuf));
  mqtt.setWill(willTopic.c_str(), willBuf, /*retained=*/true, /*qos=*/1);
}

static bool wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.begin(OO_WIFI_SSID, OO_WIFI_PASS);
  return false;   // non-blocking; auto-reconnect handles the rest
}

static bool mqttConnect() {
  if (!wifiUp()) return false;
#if OO_MQTT_TLS
  // mTLS validates the broker cert's validity dates, which needs a real clock.
  // Defer while time is still "uptime" (un-synced) — but don't brick forever:
  // after 30 s of trying, proceed anyway (RTC/NTP/cell usually arrive < 30 s).
  if (ooTimeSrc()[0] == 'u' && millis() < 30000) return false;
#endif
  const OoIdentity& id = ooId();
  bool ok = strlen(OO_MQTT_USER)
              ? mqtt.connect(id.clientId.c_str(), OO_MQTT_USER, OO_MQTT_PASS)
              : mqtt.connect(id.clientId.c_str());
  if (!ok) return false;

  // Birth: retained online status clears the Will (spec §5).
  JsonDocument b;
  b["ts"] = ooEpochMs(); b["device_id"] = id.device; b["product"] = id.product;
  b["state"] = "online"; b["fw"] = id.fw; b["ip"] = WiFi.localIP().toString();
  char buf[224]; size_t n = serializeJson(b, buf);
  mqtt.publish(full("status").c_str(), buf, (int)n, /*retained=*/true, /*qos=*/1);

  mqtt.subscribe(full("config").c_str(), 1);
  mqtt.subscribe(full("cmd/+").c_str(),  1);
  mqtt.subscribe(full("ota/cmd").c_str(), 1);
  return true;
}

static void drainQueue(QueueHandle_t q) {
  EgressMsg m;
  while (xQueueReceive(q, &m, 0) == pdTRUE) {
    String t = m.absolute ? String(m.topic) : full(m.topic);
    mqtt.publish(t.c_str(), m.payload, (int)m.len, m.retain, m.qos);
    mqtt.loop();
  }
}

void ooMqttService() {
  if (!mqtt.connected()) {
    if (millis() - lastAttempt >= backoffMs) {
      lastAttempt = millis();
      if (mqttConnect()) backoffMs = 1000;
      else { uint32_t nb = backoffMs * 2; if (nb > 30000) nb = 30000; backoffMs = nb + (esp_random() % 500); }
    }
    return;
  }
  mqtt.loop();
  drainQueue(gEgressHi);     // alarms / status / diag first (spec §14)
  drainQueue(gEgressLo);     // telemetry / heartbeat
}

// Intentional offline for deep sleep: publish a retained "asleep" status, then a
// clean DISCONNECT so the broker discards the Will (no false "offline" alarm).
// Call only from the MQTT task.
void ooMqttGracefulSleep() {
  if (!mqtt.connected()) return;
  JsonDocument d;
  d["ts"] = ooEpochMs(); d["device_id"] = ooId().device;
  d["state"] = "asleep"; d["reason"] = "duty_cycle";
  char buf[160]; size_t n = serializeJson(d, buf);
  mqtt.publish(full("status").c_str(), buf, (int)n, /*retained=*/true, /*qos=*/1);
  mqtt.loop();
  mqtt.disconnect();
}

bool        ooMqttConnected() { return mqtt.connected(); }
const char* ooTransport()     { return WiFi.status() == WL_CONNECTED ? "wifi" : "none"; }
int         ooRssi()          { return WiFi.RSSI(); }
