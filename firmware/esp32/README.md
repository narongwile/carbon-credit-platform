# ESP32-S3 Unified Firmware (ONEOPS / ETERNITY)

One firmware image, three product profiles — **eternity** (transformer),
**carbonbox** (refrigeration), **bloodbox** (cold-chain) — implementing the MQTT
telemetry contract from [`docs/esp32-platform-spec.tex`](../../docs/esp32-platform-spec.tex)
and feeding the **Node-RED ingest flow** (`backend/node-red/flows.nodered-backend.json`).

```
ESP32-S3 ──MQTT──▶ broker (EMQX / Mosquitto) ──telemetry/#──▶ Node-RED `normalize`
   per-channel envelope          │                               → maps channel→param
   {device_id,channel,value}     │                               → ingest → alarm engine
                                  └─ P/status (birth/will), P/heartbeat, P/diag/log
```

## What this build implements (the cloud contract)
| Spec | Topic | Here |
|---|---|---|
| §2/§5 presence | `P/status` retained Will + birth | ✅ |
| §3 liveness | `P/heartbeat` every 30 s | ✅ |
| §6 telemetry | `P/sensors/{sid}/raw` per-channel envelope | ✅ |
| §7 downlink | subscribe `P/config`, `P/cmd/+`, `P/ota/cmd` | ✅ (config sample-rate + reboot applied) |
| §12 product profile | one image, channel set per product | ✅ |
| §15 reconnect | exponential backoff + jitter | ✅ |
| §10.1 timestamps | NTP-synced epoch ms | ✅ |

`P = {OO_TOPIC_ROOT}/{tenant}/{product}/{device}`.

## Intentionally stubbed (production-only, marked in code)
mutual-TLS X.509 provisioning (§2), **A/B signed OTA** with rollback (§4/§24),
**4G/LoRa** failover + transport hysteresis (§15/§21), and the **FreeRTOS task
split** with a priority egress queue (§14). This dev build is a single
`loop()` with simulated sensors so the *telemetry path* can be exercised
end-to-end against the real backend. **MQTT QoS:** PubSubClient publishes at
QoS 0; the spec's QoS 1 + PUBACK and MQTT 5 session-expiry need an ESP-IDF
`esp-mqtt` (MQTT 5) client — swap the transport layer for production.

## Build & flash (PlatformIO)
```bash
cd firmware/esp32
# edit src/config.h: Wi-Fi, broker host, OO_PRODUCT + OO_DEVICE_ID
pio run -t upload && pio device monitor
```
`OO_DEVICE_ID` must match a provisioned node row / alarm rule (e.g. `tr-001`,
`cn-01`, `bb-101`) for the engine to evaluate and alert.

## How it reaches the Node-RED flow
The flow subscribes to `telemetry/#`. Set `OO_TOPIC_ROOT "telemetry"` (default)
so every publish lands there. The `normalize` node accepts the spec per-channel
envelope **and** maps spec channel names to alarm-engine param keys:

| Firmware channel (spec) | Engine param | | Firmware channel | Engine param |
|---|---|---|---|---|
| `oil_temp_c` | `oilTemp` | | `oil_level_pct` | `oilLevel` |
| `ambient_temp_c` | `ambientTemp` | | `load_pct` | `load` |
| `dga_h2_ppm` | `hydrogen` | | `temp_c` | `tempHigh` + `tempLow` |
| `moisture_ppm` | `moisture` | | `door_state` | `door` |
| `rh_pct` | `rh` | | `batt_pct` | `battery` |

After mapping, `normalize → ingest → evaluate` persists readings, raises events,
and dispatches notifications — identical to MQTT from any other source.

## Telemetry modes (`OO_NODERED_COMPAT` in config.h)
- **`1` (default)** — one consolidated `{nodeId,values,ts}` per cycle to
  `telemetry/{device_id}` (fewest messages; engine groups by timestamp).
- **`0`** — canonical spec: one envelope per channel to `P/sensors/{sid}/raw`.

Both are understood by `normalize`. Use mode `0` to mirror production exactly.

## Files
| File | Role |
|---|---|
| `src/config.h` | identity, Wi-Fi, broker, cadence, topic root, compat toggle |
| `src/product_profile.{h,cpp}` | channel sets per product (spec §6/§8) + dev sim read |
| `src/main.cpp` | Wi-Fi/MQTT, birth/will, heartbeat, sampling, downlink, backoff |
| `platformio.ini` | board + deps (PubSubClient, ArduinoJson) |
