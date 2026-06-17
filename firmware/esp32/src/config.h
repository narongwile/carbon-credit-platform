#pragma once
// ===========================================================================
// Build-time configuration. In production these are NOT compiled in — the
// device receives its identity (cert CN = {tenant}.{product}.{device}) and
// PRODUCT PROFILE from zero-touch provisioning (spec §2, §13) and stores them
// in NVS. For dev / bring-up they are set here.
// ===========================================================================

// ---- Identity --------------------------------------------------------------
#define OO_TENANT      "acme"
#define OO_PRODUCT     "eternity"     // eternity | carbonbox | bloodbox
#define OO_DEVICE_ID   "tr-001"       // must match a provisioned node row / alarm rule
#define OO_FW_VERSION  "1.4.2"

// ---- Wi-Fi (transport rank 0; 4G/LoRa fallback are stubbed, see README) ----
#define OO_WIFI_SSID   "your-ssid"
#define OO_WIFI_PASS   "your-pass"

// ---- MQTT broker (EMQX in prod; Mosquitto / Node-RED broker in dev) --------
#define OO_MQTT_HOST   "mqtt.data.svc.cluster.local"
#define OO_MQTT_PORT   1883
#define OO_MQTT_USER   ""             // optional (empty = anonymous)
#define OO_MQTT_PASS   ""
#define OO_MQTT_TLS    0              // 1 = TLS (prod uses mutual TLS 1.3 + X.509); 0 = plain dev

// ---- Topic root ------------------------------------------------------------
// ""          -> spec form P = {tenant}/{product}/{device}      (production / EMQX)
// "telemetry" -> P = telemetry/{tenant}/{product}/{device}, so every publish
//                lands under the Node-RED flow's `telemetry/#` subscription (dev).
#define OO_TOPIC_ROOT  "telemetry"

// ---- Cadence (ms) ----------------------------------------------------------
#define OO_HEARTBEAT_MS  30000        // spec §3: liveness every 30 s, QoS 0
#define OO_SAMPLE_MS     1500         // spec §3: per-sensor reading every 1.5 s

// ---- Node-RED compatibility ------------------------------------------------
// 1 -> publish ONE consolidated {nodeId,values,ts} per cycle (cheapest; the
//      ingest engine groups by ts anyway). 0 -> publish one spec per-channel
//      envelope per channel to P/sensors/{sid}/raw (canonical, spec §6).
// The Node-RED `normalize` node understands BOTH shapes.
#define OO_NODERED_COMPAT 1
