# ESP32-S3 unified firmware — concept design

One firmware image runs **all three products** — `bloodBOX`, `refrigeDataLogger`
(carbonbox), `transformersMonitoring` (eternity) — on the same ESP32-S3 PCB. Behaviour is
selected at runtime by a **product profile**, not by separate builds.

Open `esp32-firmware-concept.drawio` in [draw.io](https://app.diagrams.net); it has 4 pages:
**(1)** layered architecture, **(2)** boot & provisioning flow, **(3)** runtime FreeRTOS
tasks & data flow, **(4)** per-product sensor→HAL→envelope mapping. This file is the concept
narrative; it pairs with `esp32-firmware-sequence.*` (the MQTT/EMQX contract) and
`esp32-pcb-functions.*` (the hardware map).

## The one idea: a product-profile abstraction
Everything above the driver layer is **product-agnostic**. A single profile object —
```
profile = { product_id, channel_set, sample_rates, thresholds, transport }
```
loaded from the retained `…/config` payload (or NVS on first boot) decides **which drivers and
channels are active**, at what rate, and against which thresholds. Add a product = add a
profile + drivers; the connectivity, telemetry, alarm, and OTA layers never change.

## 1. Layered architecture
| Layer | Responsibility |
| --- | --- |
| Hardware | ESP32-S3-WROOM-1 (N16R8) + PCB (CAN, RS485, 4G, LoRa, I²C, ADC/CT, DI/DO, SD, USB) |
| HAL / BSP | pin-map, bus drivers (I²C/UART/SPI/ADC/GPIO/CAN), A/B partition table |
| Drivers | temp, humidity, accel/impact, GPS, baro, DGA, door, current(CT), relay, LCD, FATFS, modem, LoRa |
| **Product profile** | **selects active channels + rates + thresholds (compatibility layer)** |
| App services | sensor sampler, edge alarm engine, telemetry serializer, config mgr, OTA agent, ring buffer |
| Connectivity | Wi-Fi→4G→LoRa failover, MQTT 5.0 (mTLS), provisioning client |
| Cloud | EMQX broker → per-product ingest (`$share/ingest-<product>`) |

Cross-cutting: **Security** (secure boot, flash encryption, per-device mTLS, encrypted NVS,
ACL) and **RTOS/reliability** (FreeRTOS, task watchdog, brown-out, store-and-forward, A/B OTA).

## 2. Boot & provisioning
Power-on → secure boot → HAL/NVS init → **provisioned?**
- **No** → bootstrap (TLS + factory token) → claim `chip_id` → receive cert + `client_id` +
  `device_id` + **`product_id`** → store in encrypted NVS → reboot.
- **Yes** → load cert + **product profile** → init active drivers → link bring-up
  (Wi-Fi→4G→LoRa) → MQTT connect (mTLS, LWT) → birth + subscribe `config/cmd/ota` → apply
  retained thresholds → enter runtime.

## 3. Runtime (FreeRTOS tasks)
- **SensorTask** — sample active channels at profile rates → sample queue.
- **EdgeAlarmTask** — evaluate thresholds (from retained config); breach → immediate alarm PUB.
- **TelemetryTask** — serialize canonical envelope, per-channel PUB (QoS 1), heartbeat 30 s (QoS 0).
- **LinkMgr/ConnTask** — Wi-Fi/4G/LoRa failover, MQTT keepalive + reconnect.
- **ConfigTask / CmdTask / OTATask** — handle downlinks (thresholds/rates, `cmd/{op}`, signed A/B OTA).
- **Watchdog (TWDT)** — resets on task hang.
- **Offline:** telemetry → SD ring buffer → replay on reconnect.

## 4. Per-product channel → HAL → envelope
| Product | Channels (interface) |
| --- | --- |
| **bloodBOX** | `temp_c`(I²C), `rh_pct`(I²C), `batt_pct`(ADC), `impact_g`(I²C accel), `gps`(UART), `baro_alt_m`(I²C) |
| **refrigeDataLogger** | `temp_c`(I²C/1-wire), `door_state`(DI), `online`(link) |
| **transformersMonitoring** | `oil_temp_c`(RS485/ADC), `ambient_temp_c`(I²C), `dga_h2_ppm`(RS485), `moisture_ppm`(RS485), `oil_level_pct`(ADC), `load_pct`(CT) |

Each active channel publishes **one** `sensors/{sid}/raw` message in the shared canonical
envelope `{ts, device_id, product, channel, value, unit, quality}` (QoS 1). EMQX routes by the
`product` segment to the matching ingest pool, which resolves `host_fk ∈ {t,c,b}` and joins the
correct `*_sensor_specs` table — so the 6-channel transformer and the 2-channel fridge share
one pipeline. (Full contract: `esp32-firmware-sequence.*`.)

> Interface assignments (I²C vs ADC vs RS485) are the concept-level intent from the PCB map;
> confirm against the final sensor BOM before implementation.
