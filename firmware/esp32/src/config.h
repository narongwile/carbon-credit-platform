#pragma once
// ===========================================================================
//  Build-time DEFAULTS (dev / bring-up).
//
//  In production the device receives its identity (cert CN = {tenant}.{product}
//  .{device}), per-device mTLS cert/key and product profile from zero-touch
//  provisioning (spec §2/§13/§19) and stores them in NVS. At runtime
//  identity.cpp prefers the NVS values and falls back to the macros below so a
//  freshly-flashed unit still boots on the bench.
// ===========================================================================

// ---- Firmware version (also injected via -DOO_FW_VERSION in platformio.ini)
#ifndef OO_FW_VERSION
#define OO_FW_VERSION  "2.0.0"
#endif

// ---- Default identity (NVS overrides these) --------------------------------
#define OO_TENANT      "acme"
#define OO_PRODUCT     "eternity"     // eternity | carbonbox | bloodbox
#define OO_DEVICE_ID   "tr-001"       // must match a provisioned node row / alarm rule

// ---- Wi-Fi (transport rank 0; 4G/LoRa are interfaces in net_mqtt, see README)
#define OO_WIFI_SSID   "your-ssid"
#define OO_WIFI_PASS   "your-pass"

// ---- MQTT broker -----------------------------------------------------------
#define OO_MQTT_HOST   "mqtt.data.svc.cluster.local"
#define OO_MQTT_PORT   8883           // 8883 = TLS (prod); 1883 = plain (dev)
#define OO_MQTT_USER   ""             // empty = anonymous / cert-only auth
#define OO_MQTT_PASS   ""
#define OO_MQTT_TLS    1              // 1 = TLS/mTLS (prod); 0 = plain dev broker

// ---- Topic root ------------------------------------------------------------
// ""          -> spec form  P = {tenant}/{product}/{device}        (production)
// "telemetry" -> P = telemetry/{tenant}/{product}/{device}         (Node-RED dev)
#define OO_TOPIC_ROOT  ""

// ---- Cadence (ms) ----------------------------------------------------------
#define OO_HEARTBEAT_MS  30000        // spec §3: liveness every 30 s
#define OO_SAMPLE_MS     1500         // spec §3: per-sensor reading every 1.5 s (0 = use profile)

// ---- External RTC (DS3231 on I2C) — audit-grade offline time (spec §10.1) ---
#define OO_RTC_ENABLE    1
#define OO_I2C_SDA       8            // set to the schematic's SDA net
#define OO_I2C_SCL       9            // set to the schematic's SCL net
#define OO_DS3231_ADDR   0x68
#define OO_NTP_SERVER1   "pool.ntp.org"
#define OO_NTP_SERVER2   "time.nist.gov"

// ---- Status LEDs (spec §10/§16 — error blink codes) ------------------------
#define OO_LED_GREEN     47
#define OO_LED_RED       48

// ---- Telemetry shape -------------------------------------------------------
// 1 -> one consolidated {nodeId,values,ts} per cycle (Node-RED compat).
// 0 -> canonical spec: one envelope per channel on P/sensors/{sid}/raw (§6).
#define OO_NODERED_COMPAT 0

// ---- NVS namespace ---------------------------------------------------------
#define OO_NVS_NS        "oneops"

// ---- FreeRTOS task stacks / priorities (spec §22) --------------------------
#define OO_STACK_SENSOR  4096
#define OO_STACK_MQTT    8192
#define OO_STACK_ALARM   3072
#define OO_STACK_WDT     2048
#define OO_EGRESS_DEPTH  32           // priority egress queue depth (spec §14)
#define OO_WDT_TIMEOUT_S 30           // task watchdog (spec §14)
