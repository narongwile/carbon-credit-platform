# ESP32-S3 Unified Firmware (ONEOPS / ETERNITY) — production build

One firmware image, three product profiles — **eternity** (transformer),
**carbonbox** (refrigeration), **bloodbox** (cold-chain) — implementing the
MQTT/EMQX contract in [`docs/esp32-platform-spec.tex`](../../docs/esp32-platform-spec.tex)
(PR #6). Target board: **ESP32-S3-WROOM-1 (N16R8)** — 16 MB flash, 8 MB OPI PSRAM.

> ⚠️ **Build status:** statically analysed (cppcheck, clean) but not compiled in
> this sandbox (PlatformIO registry is network-blocked here). The
> **`firmware-ci` GitHub Action** (`.github/workflows/firmware-ci.yml`) compiles
> both envs on push — that is the real build gate. Bench-validate on N16R8 before
> field use. See *Validation status* below.
>
> **UART map (distinct controllers, no peripheral clash):** RS-485 = UART1
> (GPIO43/44), GPS = UART2 (GPIO16/15), 4G modem = UART0 (GPIO17/18). Only the
> **pins** are `[VERIFY]` against the schematic.

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
| §6 | per-channel envelope on `P/sensors/{sid}/raw` + **real bus reads** (`quality`) | ✅ |
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
| §8/§9 | **edge-alarm debounce** (N-consecutive WARNING, immediate CRITICAL, event-dwell, cooldown/dedup) | ✅ |
| §14 | **store-and-forward** to LittleFS when offline + replay on reconnect | ✅ |
| §21 | **transport ranking + hysteresis** (Wi-Fi concrete; 4G/LoRa hooks) | ✅ logic / hooks |

### Per-product features
| Product | Added |
| --- | --- |
| **eternity** | DGA H2 **rate-of-rise** trend (`dga_h2_rate` in heartbeat); Modbus + CAN sensor mix |
| **carbonbox** | **door-open dwell** debounce (alarm only after `OO_EVENT_DEBOUNCE_MS`); **compressor** relay sense (DI) |
| **bloodbox** | real **battery %** in heartbeat; **transit FSM** (idle→in_transit→arrived→stored); **GPS** (NMEA RMC) lat/lng; **transit-aware power cadence**; **deep-sleep duty cycle when STORED** (`OO_DEEPSLEEP_ENABLE`, transit state persisted in RTC memory across the reset); **4G failover hook** (`modem_4g.cpp`) |

## Sensor drivers (demo — real buses, per the schematic)
`drivers.cpp` reads each channel from the actual bus on the board (pins in
`board_pins.h`, mapped from the CAN/485 + MCU schematic sheets). A failed read
(sensor absent / NACK / CRC / timeout) is tagged `quality="error"`, or — with
`OO_SIM_FALLBACK=1` — substituted by a simulated value tagged `quality="sim"`,
so the demo runs on a bare board. Set `OO_USE_REAL_SENSORS=0` for pure simulation.

| Product | Channel → bus (driver) |
| --- | --- |
| **eternity** | `oil_temp_c`,`moisture_ppm`,`oil_level_pct` → **RS-485 Modbus-RTU** (MAX3485, DE=GPIO10, UART0 43/44); `dga_h2_ppm`,`ambient_temp_c` → **CAN / TWAI** (SN65HVD230, TX=GPIO14, RX=GPIO13, IDs 0x201/0x202); `load_pct` → **ADC** (CT) |
| **carbonbox** | `temp_c` → **I²C TMP117** (0x48, precision cold-chain probe); `door_state` → **digital input** (debounced) |
| **bloodbox** | `temp_c`/`rh_pct` → **I²C SHT31** (0x44); `baro_alt_m` → **I²C BMP280** (0x76, Bosch compensation); `impact_g` → **I²C ADXL345** (0x53, \|a\|−1g); `batt_pct` → **ADC** (divider) |

CAN frames carry `int16` big-endian `value*10` in `data[0..1]` (500 kbit/s) — a
demo convention; match it to the real CAN sensor. Modbus holding registers use
the same `reg/10` scaling.

Bus pins from the schematic — **[HIGH]** confidence: CAN GPIO14/13, RS-485
GPIO43/44 + DE GPIO10, LEDs GPIO47/48, UART1 (4G/LoRa) GPIO17/18, SD GPIO45.
**I²C SDA=GPIO1, SCL=GPIO2** (derived from the WROOM-1 pinout: MCU_SDA=pin39=IO1,
MCU_SCL=pin38=IO2). **[VERIFY]**: I²C pins, CT/battery ADC, door DI, DO1/DO2,
and the I²C part numbers / Modbus+CAN maps against the populated BOM.

## Validation status (honest)
- **Not compiled here** — needs `pio run` on a real toolchain. Two third-party
  APIs are the most likely to need a tweak per core version: `arduino-mqtt`
  (`MQTTClient::setOptions/publish/setWill`) and `esp_https_ota` handle calls.
- **MQTT 5 session-expiry** (§1) — arduino-mqtt is MQTT 3.1.1; QoS 1 + LWT +
  persistent session are covered, but true MQTT 5 session-expiry needs the
  ESP-IDF `esp-mqtt` client (`CONFIG_MQTT_PROTOCOL_5`). Documented trade-off.
- **secure-boot V2 + flash-encryption** (§19) — these are **eFuse EOL steps**,
  burned by the factory line, not by this build (`platformio.ini` notes it).
- **4G modem** — `modem_4g.cpp` provides strong `ooCellAvailable()` + `ooCellTime()`
  (modem bring-up, registration, tower clock) via TinyGSM, gated by `OO_HAVE_TINYGSM`;
  timekeeping uses the modem clock when NTP can't run (4G). Remaining 4G work:
  (a) route the MQTT/TLS session over the modem (TinyGsmClient in `net_mqtt.cpp`),
  (b) **OTA** — `esp_https_ota` needs LwIP, so 4G OTA requires bringing the modem up
  as an **ESP-IDF PPP netif** (recommended) or a manual `esp_ota_*` download; and
  (c) prefer the **modem's hardware TLS** (load certs into the SIM7600 via AT) over
  software TLS, which is RAM-heavy on the ESP32.
- **Wake-on-impact** — in deep sleep the ADXL345 activity interrupt (INT1 → ext0)
  wakes the bloodbox; `setup()` checks `ooWokeOnImpact()` and `SensorTask` rushes the
  `impact_g` reading + edge alarm out before the normal cadence.
- **4G/LoRa transport** — the ranking + **hysteresis logic** is implemented
  (`transport.cpp`) with Wi-Fi concrete; `ooCellAvailable()`/`ooLoRaAvailable()`
  are weak hooks returning false. Wiring the actual radios needs **TinyGSM** (4G)
  and an **SX127x/E220 LoRa** driver + hardware — not built here.
- **GPS** — a minimal NMEA-RMC parser is implemented (no library), but the GPS
  UART pins are **[VERIFY]** placeholders and it needs a real receiver to validate.
- **BLE indoor-floor beacons** — interface only (`OO_BLE_ENABLE=0`); a NimBLE scan
  + Wi-Fi/BLE coexistence tuning is required (RAM-heavy) — left as a hook.
- **Deep sleep** — `ooEnterDeepSleep()` exists for a duty-cycle build; the always-on
  demo uses transit-aware cadence (not deep sleep) so MQTT/OTA stay live.
- **Sensor drivers** — now real (Modbus/I²C/ADC/DI) with sim fallback, but the
  I²C device part numbers (SHT3x/BMP280/ADXL345) and the **[VERIFY]** pins in
  `board_pins.h` are assumptions — confirm against the populated BOM/schematic.
  The Modbus register map (`reg/10`) is a demo convention; match it to the real
  transformer sensor's map.

## Files
| File | Role |
|---|---|
| `platformio.ini` | N16R8 board (16 MB + OPI PSRAM), `partitions.csv`, deps |
| `partitions.csv` | frozen A/B layout (spec §20) |
| `src/config.h` | dev defaults / cadence / toggles (includes `board_pins.h`) |
| `src/board_pins.h` | GPIO / bus map read from the schematic |
| `src/identity.{h,cpp}` | NVS identity + mTLS certs (provisioning, §2/§13) |
| `src/timekeeping.{h,cpp}` | NTP + DS3231 RTC + `time_src` (§10.1) |
| `src/product_profile.{h,cpp}` | channel sets + thresholds + bus routing + severity (§6/§8) |
| `src/drivers.{h,cpp}` | real sensor reads: Modbus / CAN(TWAI) / I²C / ADC / DI + `quality` (§6/§16) |
| `src/alarm.{h,cpp}` | edge-alarm debounce state machine (§8/§9) |
| `src/store.{h,cpp}` | LittleFS store-and-forward (offline audit, §14) |
| `src/trend.{h,cpp}` | local rate-of-rise (eternity DGA) |
| `src/transport.{h,cpp}` | transport ranking + hysteresis (§21) + 4G/LoRa hooks |
| `src/gps.{h,cpp}` | NMEA-RMC GPS parser (bloodbox) |
| `src/transit.{h,cpp}` | bloodbox transit state machine |
| `src/power.{h,cpp}` | battery read + transit-aware cadence + deep-sleep helper |
| `src/modem_4g.{h,cpp}` | 4G modem (TinyGSM) — `ooCellAvailable()` for failover |
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
