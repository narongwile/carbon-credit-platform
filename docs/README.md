# ESP32-S3 firmware — corrected MQTT sequence

`esp32-firmware-sequence.tex` redraws the ESP32-S3 production firmware lifecycle
from the *Unified Technical Specification v1.0* as a set of UML-style sequence
diagrams, corrected to follow **EMQX** broker best practices (MQTT 5.0).

It covers four phases plus the topic/QoS contract:

- **Phase A** — zero-touch provisioning (factory token → per-device X.509 cert)
  and secure session bring-up (mutual TLS 1.3, persistent session, birth-and-will).
- **Phase B** — steady-state telemetry (QoS 0 heartbeat, QoS 1 sensor readings
  consumed through an EMQX shared subscription).
- **Phase C** — signed OTA update with SHA-256 + secure-boot verification and
  A/B partition rollback.
- **Phase D** — ungraceful disconnect handled by the retained Last Will.

The diagrams are drawn in pure TikZ — no external sequence-diagram package is
required, so any reasonably complete TeX Live install can build it.

## Build

```bash
make            # -> esp32-firmware-sequence.pdf
# or:
pdflatex esp32-firmware-sequence.tex   # run twice
```

Requires `pdflatex` with TikZ (`texlive-latex-base`, `texlive-latex-recommended`,
`texlive-pictures`, `texlive-fonts-recommended`).
