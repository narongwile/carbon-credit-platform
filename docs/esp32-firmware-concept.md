# ESP32-S3 unified firmware — concept design

One firmware image runs **all three products** — `bloodBOX`, `refrigeDataLogger`
(carbonbox), `transformersMonitoring` (eternity) — on the same ESP32-S3 PCB. Behaviour is
selected at runtime by a **product profile**, not by separate builds.

Open `esp32-firmware-concept.drawio` in [draw.io](https://app.diagrams.net); it has 5 pages:
**(1)** layered architecture, **(2)** boot & provisioning flow, **(3)** runtime FreeRTOS
tasks & data flow, **(4)** per-product sensor→HAL→envelope mapping, **(5)** Link Manager
state machine. This file is the concept narrative; it pairs with `esp32-firmware-sequence.*`
(the MQTT/EMQX contract) and `esp32-pcb-functions.*` (the hardware map).

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

## 5. Robustness & fault handling (design decisions)
These resolve the failure modes a happy-path flow hides. Each is reflected in the diagram.

### Boot & provisioning (page 2)
- **HW self-test → Safe Mode.** After `Init HAL/BSP, mount NVS+FATFS(SD)` a self-test gates
  the flow. On fault (SD dead, I²C bus stuck, power rail bad) it branches to **Safe Mode /
  Error State** instead of hanging: blink an **LED error code**, log the fault to NVS, **skip
  the faulty subsystem**, and still attempt a *report-only* link so the error log reaches the
  cloud when connectivity is up.
- **Exponential backoff on bootstrap & link.** `BOOTSTRAP`/`Link bring-up` no longer assume
  success. A `Server OK?` / `Any link up?` decision feeds a **retry with exponential backoff
  (capped + jitter)** so a dead server or dead network can't make the device hammer/drain the
  battery or get rate-banned.
- **Link-fallback loop.** `Wi-Fi → 4G → LoRa` ends in `Any link up?`. If **all** fail, the
  flow loops to **Wait / light-sleep + backoff**, then retries bring-up — it never falls
  through into `MQTT connect` without a link layer. `MQTT connected?` likewise loops back to
  backoff on failure.

### Runtime (page 3)
- **Central priority egress queue.** `EdgeAlarmTask` and `TelemetryTask` no longer call
  publish directly (avoids a race if the MQTT client isn't fully thread-safe). They **enqueue**
  to a single **Egress/Publish Queue**; **LinkMgr is the only consumer**, draining one message
  at a time with **priority ALARM (QoS 1) > Telemetry**.
- **Buffer-overflow policy (explicit).** Ring buffer / SD store-and-forward is **FIFO
  drop-OLDEST** for telemetry and **never drops alarms** — stated on the diagram so the
  behaviour under sustained offline is unambiguous.
- **Watchdog mechanism (explicit).** Each task feeds a **heartbeat flag** to the central
  **Watchdog (TWDT)** task; a missing flag triggers a **targeted reset** that pinpoints the
  hung task rather than a blind reboot.

### HAL & envelope (page 4)
- **Sensor-fault → `quality`.** On read failure (open wire, loose terminal, I²C timeout/NACK)
  the HAL emits **`quality = error:<code>`** — never a misleading `value = 0`. A stale read is
  `quality = stale`. This lets EMQX/ingest distinguish **"real 0 °C"** from **"dead sensor"**
  and flag bad-quality samples out of trend calculations.
- **DI debounce in ISR.** Digital inputs such as `door_state` are **debounced (~50 ms) and
  rate-limited in the ISR**, so a vibrating door can't flood the sample queue with spike
  events.

## 6. Link Manager state machine (page 5)
The connectivity layer is a small FSM so failover, retry, and logging are explicit rather
than ad-hoc.

| State | Meaning / entry actions |
| --- | --- |
| **CONNECTING** | try transports in order Wi-Fi → 4G → LoRa, each with a timeout |
| **CONNECTED** | publish birth (retain); **drain egress queue** (Alarm QoS 1 > Telemetry); **flush error-log** to `diag/log`; heartbeat 30 s / keepalive 60 s |
| **RECONNECTING** | quick retry on the **same** transport (short fixed delay) |
| **BACKOFF** | **exponential backoff (cap + jitter)**, sleep timer, cycle transports — protects battery / avoids broker ban |
| **OFFLINE** | no transport; **store-and-forward** (SD, drop-oldest), buffer error-logs in NVS ring, periodic wake to retry |

**Key transitions (guard / action):**
- `CONNECTING → CONNECTED` link+MQTT ok · `CONNECTING → BACKOFF` all transports failed / `log(err)`
- `CONNECTED → RECONNECTING` keepalive miss \| publish fail \| link down / `log(warn)`
- `RECONNECTING → CONNECTED` reconnect ok · `RECONNECTING → BACKOFF` retry > N / `log(err)`
- `BACKOFF → CONNECTING` timer expires / next transport · `BACKOFF → OFFLINE` max backoff & no transport / `log(err)`
- `OFFLINE → CONNECTING` periodic wake / retry

**Error/event logging (cross-cutting).** Every failure transition writes to an **NVS ring
buffer** `{ts, from, to, reason, transport, rssi, level}` with `level ∈ {info, warn, err}`.
The log is **flushed to EMQX** on `…/diag/log` (QoS 1) whenever the FSM is in **CONNECTED**, so
faults that happened while offline still reach the cloud once the link returns.

### `diag/log` payload schema (v1)
Topic `{tenant}/{product}/{device}/diag/log` · QoS 1 · retain = 0 · batched flush.

```jsonc
{
  "v": 1,                       // schema version
  "device_id": "ac-fridge-0042",
  "tenant": "acme",
  "product": "carbonbox",       // eternity | carbonbox | bloodbox
  "fw": "1.4.2",
  "boot_id": 137,               // ++ each boot (detect resets)
  "sent_at": 1733740800000,     // wall clock at flush (epoch ms)
  "uptime_s": 86230,            // device uptime at flush
  "dropped": 4,                 // entries lost to ring overflow
  "events": [                   // batch flushed from the NVS ring
    {
      "seq": 5012,              // monotonic per device (gap detect / dedupe)
      "t": 1733740123000,       // epoch ms, or null if logged pre-time-sync
      "up": 85553,              // uptime_s when logged (ALWAYS set)
      "lvl": "warn",            // info | warn | err | fatal
      "code": "LINK_KEEPALIVE_MISS",
      "from": "CONNECTED",      // FSM state
      "to": "RECONNECTING",
      "tr": "wifi",             // wifi | lte | lora | none
      "rssi": -78,
      "msg": "3 keepalives missed",
      "ctx": { "heap": 142000, "retries": 0 }   // optional, code-specific
    }
  ]
}
```

**Design notes**
- **Batched:** one PUB flushes many ring entries on entering `CONNECTED` (fewer round-trips).
- **Offline-safe time:** `t` may be `null` (event logged before NTP/cell sync); `up` is
  always present, so ingest reconstructs wall time as `sent_at − (uptime_s − up)`.
- **`seq`** is monotonic so the broker side can detect gaps; **`dropped`** reports ring loss.
- **Separation of concerns:** alarms go on `…/alarm/{sid}` — `diag/log` is **operational
  health only** (link, HW, OTA, watchdog), never sensor alarms.

### Diagnostic codes (with LED blink fallback)
When offline the device signals the same fault locally via an LED blink pattern:

| `code` | `lvl` | LED blink | Meaning |
| --- | --- | --- | --- |
| `HW_SD_FAIL` | err | 2× long | SD mount/format failed |
| `HW_I2C_TIMEOUT` | err | 3× long | I²C bus stuck → recover |
| `HW_SELFTEST_OK` | info | — | all buses OK |
| `SENSOR_OPEN_WIRE` | warn | 2× short | open/loose → `quality=error` |
| `SENSOR_I2C_NACK` | warn | 2× short | no ACK → `quality=error` |
| `SENSOR_STALE` | warn | — | no fresh read → `quality=stale` |
| `PROV_TOKEN_FAIL` | err | 4× long | factory token rejected |
| `PROV_OK` | info | — | cert provisioned |
| `LINK_ALL_FAILED` | err | 1 Hz | Wi-Fi+4G+LoRa all down |
| `LINK_KEEPALIVE_MISS` | warn | — | → RECONNECTING |
| `LINK_PUBLISH_FAIL` | warn | — | publish error / requeue |
| `LINK_BACKOFF` | info | — | backoff timer armed |
| `LINK_OFFLINE` | err | 1 Hz | store-and-forward active |
| `LINK_RESTORED` | info | — | CONNECTED, flushing log |
| `BUF_OVERFLOW_DROP` | warn | — | ring full → drop oldest |
| `OTA_VERIFY_FAIL` | err | 5× short | SHA / secure-boot mismatch |
| `OTA_ROLLBACK` | err | 5× short | A/B partition reverted |
| `WDT_RESET` | fatal | solid | task hang → targeted reset |
| `BROWNOUT` | fatal | solid | power-dip reset |

