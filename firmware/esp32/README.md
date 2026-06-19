# ESP32-S3 Unified Firmware (ONEOPS / ETERNITY) — production build

One firmware image, three product profiles — **eternity** (transformer),
**carbonbox** (refrigeration), **bloodbox** (cold-chain) — implementing the
MQTT/EMQX contract in [`docs/esp32-platform-spec.tex`](../../docs/esp32-platform-spec.tex)
(PR #6). Target board: **ESP32-S3-WROOM-1 (N16R8)** — 16 MB flash, 8 MB OPI PSRAM.

> ⚠️ **Build status:** this revision was written and **statically analysed**
> (cppcheck, clean) but **was NOT compiled/flashed in this environment** — the
> PlatformIO platform/toolchain download is network-blocked here. It must be
> built on a real toolchain and bench-validated on N16R8 hardware before field
> use. See *Validation status* below.

## Architecture (FreeRTOS task split, spec §14)
```
SensorTask ─sample+edge-alarm─▶ [ egress queue Hi/Lo ] ─▶ MqttTask ─QoS1/mTLS─▶ EMQX
  (per-channel envelope §6)        alarm before telemetry     (sole publisher)
                                                              ├─ LWT + birth (§5)
OtaTask  ◀── ota/cmd ── downlink ◀────────────────────────────┤  config/cmd (§7)
  (A/B HTTPS OTA + rollback §24)                              └─ P/diag/log (§16)
Watchdog ── per-task heartbeat flags ─▶ targeted reset (§14)
Time: NTP ▸ DS3231 RTC ▸ uptime, with `time_src` (§10.1)
```
Only `MqttTask` touches the MQTT client; other tasks hand work to a priority
**egress queue** (alarms drained before telemetry; telemetry is FIFO drop-oldest
on overflow, alarms are never dropped).

## What this build implements
| Spec | Feature | Status |
|---|---|---|
| §1/§6 | MQTT **QoS 1** + LWT (arduino-mqtt, replaces PubSubClient QoS0) | ✅ |
| §2 | **mutual TLS** (X.509 client cert/key from NVS) | ✅ (certs provisioned) |
| §5 | retained Will + birth on `P/status` | ✅ |
| §3 | `P/heartbeat` every 30 s (rssi, batt, uptime, fw, heap, time_src, transport) | ✅ |
| §6 | per-channel envelope on `P/sensors/{sid}/raw` (or Node-RED consolidated) | ✅ |
| §7 | downlink `P/config` (sample rate, cfg_v) / `P/cmd/+` (reboot) / `P/ota/cmd` | ✅ |
| §8/§9 | edge-alarm fast-path (per-product thresholds → `P/alarm/{sid}` hint) | ✅ |
| §10.1 | external **DS3231 RTC** + NTP, `time_src`, RTC discipline | ✅ |
| §12 | one image, runtime product profile | ✅ |
| §13/§19 | identity + certs from **NVS** (compile-time fallback for bench) | ✅ |
| §14 | FreeRTOS task split + priority egress queue + per-task watchdog | ✅ |
| §15 | reconnect exponential backoff (cap 30 s) + jitter | ✅ |
| §20 | frozen 16 MB A/B **partition table** (`partitions.csv`) | ✅ |
| §24 | **A/B HTTPS OTA** + rollback + version gate + download retries | ✅ |
| §25 | config versioning (`cfg_v`) + persisted sample rate | ✅ (partial) |

## Validation status (honest)
- **Not compiled here** — needs `pio run` on a real toolchain. Two third-party
  APIs are the most likely to need a tweak per core version: `arduino-mqtt`
  (`MQTTClient::setOptions/publish/setWill`) and `esp_https_ota` handle calls.
- **MQTT 5 session-expiry** (§1) — arduino-mqtt is MQTT 3.1.1; QoS 1 + LWT +
  persistent session are covered, but true MQTT 5 session-expiry needs the
  ESP-IDF `esp-mqtt` client (`CONFIG_MQTT_PROTOCOL_5`). Documented trade-off.
- **secure-boot V2 + flash-encryption** (§19) — these are **eFuse EOL steps**,
  burned by the factory line, not by this build (`platformio.ini` notes it).
- **4G/LoRa transport + §21 hysteresis** — Wi-Fi is implemented; `ooTransport()`
  is the integration hook. The cellular/LoRa radio drivers are out of scope for
  this carrier build (the spec §18/§21 defines the contract).
- **Sensor drivers** — `ooSimRead()` is a simulator; replace per-channel with the
  real I²C/ADC/RS-485 driver reads. GPIO/I²C pins in `config.h` are placeholders —
  set them from the schematic.

## Files
| File | Role |
|---|---|
| `platformio.ini` | N16R8 board (16 MB + OPI PSRAM), `partitions.csv`, deps |
| `partitions.csv` | frozen A/B layout (spec §20) |
| `src/config.h` | dev defaults / pins / cadence / toggles |
| `src/identity.{h,cpp}` | NVS identity + mTLS certs (provisioning, §2/§13) |
| `src/timekeeping.{h,cpp}` | NTP + DS3231 RTC + `time_src` (§10.1) |
| `src/product_profile.{h,cpp}` | channel sets + thresholds + severity eval (§6/§8) |
| `src/oneops.{h,cpp}` | egress queue + shared contracts (§14) |
| `src/net_mqtt.{h,cpp}` | Wi-Fi + MQTT QoS1/LWT/mTLS + downlink (§1/§5/§7/§15) |
| `src/ota.{h,cpp}` | A/B HTTPS OTA + rollback (§24) |
| `src/main.cpp` | tasks + wiring + software watchdog |

## Build, provision & flash
```bash
cd firmware/esp32
# 1) set src/config.h: Wi-Fi, broker host/port, default identity, I2C/LED pins
pio run -e wroom1-n16r8                 # build (use -e devkitc-1 for the 8 MB devkit)
pio run -e wroom1-n16r8 -t upload && pio device monitor
```
**Provisioning (production):** write the per-device identity + mTLS material to
NVS (namespace `oneops`) instead of `config.h` — keys `tenant`, `product`,
`device`, `ca`, `cert`, `key`. The EOL line does this after burning eFuses
(spec §19); `identity.cpp` prefers NVS and falls back to `config.h` for the bench.

`OO_DEVICE_ID` must match a provisioned node row / alarm rule (e.g. `tr-001`,
`cn-01`, `bb-101`) for the engine to evaluate and alert.
