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
#include "board_pins.h"               // GPIO / bus map from the schematic

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

// ---- Time (DS3231 RTC pins/addr live in board_pins.h) — spec §10.1 ---------
#define OO_RTC_ENABLE    1
#define OO_NTP_SERVER1   "pool.ntp.org"
#define OO_NTP_SERVER2   "time.nist.gov"

// ---- Sensor drivers --------------------------------------------------------
// 1 -> read the real buses (RS-485 Modbus / I2C / ADC / DI) per product.
// 0 -> pure simulation (no hardware).
#define OO_USE_REAL_SENSORS 1
// If a real read fails (sensor absent / NACK / CRC), fall back to a simulated
// value so the demo keeps running on a bare board. The reading is then tagged
// quality="sim" (vs "good" for a real read, "error" if no fallback) — spec §16.
#define OO_SIM_FALLBACK     1

// ---- Edge alarm debounce (spec §8/§9) --------------------------------------
#define OO_WARN_CONSEC       2        // WARNING needs N consecutive over-threshold
#define OO_EVENT_DEBOUNCE_MS 30000    // event (door open) must persist before CRITICAL
#define OO_ALARM_COOLDOWN_MS 60000    // re-fire a sustained CRITICAL at most this often

// ---- Store-and-forward (LittleFS) — offline audit buffer (spec §14) --------
#define OO_STORE_ENABLE      1
#define OO_STORE_MAX         262144   // 256 KB cap, rotate to keep the tail

// ---- BloodBOX low power + transit (spec §21 / product) ---------------------
#define OO_LOWPOWER          1        // bloodbox: transit-aware cadence + light sleep
#define OO_GPS_ENABLE        1        // NMEA parser on a UART (see board_pins.h)
#define OO_BLE_ENABLE        0        // indoor-floor iBeacon scan (needs NimBLE + Wi-Fi coex)

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
