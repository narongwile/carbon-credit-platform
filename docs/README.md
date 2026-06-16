# ESP32-S3 IoT Platform — unified specification

A single self-contained document covering the whole stack for **one firmware that runs three
products** (`bloodBOX`, `refrigeDataLogger`/carbonbox, `transformersMonitoring`/eternity) on
the ESP32-S3 PCB.

**`esp32-platform-spec.pdf`** (build from `esp32-platform-spec.tex` + `esp32-platform-parts.tex`):

- **Part I — Cloud interface & MQTT contract** (§1–§9): corrected MQTT/EMQX sequence
  (provisioning, mTLS, persistent session, LWT/birth, OTA), per-product telemetry envelope,
  per-product topic namespace, thresholds, and the alarm state machine.
- **Part II — Hardware: ESP32-S3 PCB** (§10–§11): function/signal-flow map, per-product
  sensor→interface table, **offline timekeeping** (external RTC + time-source hierarchy),
  GPIO/net map.
- **Part III — Firmware concept design** (§12–§27): layered architecture, boot & provisioning
  flow, runtime FreeRTOS tasks & data flow, Link Manager state machine, `diag/log` schema +
  diagnostic codes, robustness summary, **LoRaWAN integration** (LNS path, OTAA, binary payload),
  **End-of-Line manufacturing** (eFuse / silicon provisioning), **flash partition table**,
  **transport hysteresis**, **memory/resource budget**, **error handling & recovery**, **detailed
  OTA** (delta, fallback, version compatibility), **configuration management**, **logging strategy**
  and **testing strategy**.
- **Part IV — Appendices** (A–D): full **MQTT topic dictionary** (+ hierarchy diagram), **payload
  examples** (JSON + binary LoRaWAN), **state-machine reference** (alarm lifecycle FSM + transition
  table), and a **glossary/acronyms** table.

Every figure is drawn natively in TikZ, so the PDF needs no external images.

## Build

```bash
make            # -> esp32-platform-spec.pdf
# or:
pdflatex esp32-platform-spec.tex   # run twice (table of contents)
```

Requires `pdflatex` with TikZ and `listings` (`texlive-latex-base`,
`texlive-latex-recommended`, `texlive-pictures`, `texlive-fonts-recommended`,
`texlive-latex-extra`).

## Editable diagram sources (draw.io)

The Part II/III figures are also maintained as editable [draw.io](https://app.diagrams.net)
files (the PDF redraws them in TikZ):

- `esp32-pcb-functions.drawio` — PCB function & signal-flow map.
- `esp32-firmware-concept.drawio` — 5 pages: layered architecture, boot & provisioning,
  runtime tasks, per-product mapping, Link Manager state machine + `diag/log` schema.
