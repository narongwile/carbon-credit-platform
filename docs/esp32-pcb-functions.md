# ESP32-S3 PCB — function list & signal-flow map

Derived from the three source images: **MCU part** (ESP32-S3-WROOM-1 schematic),
**Commu part** (CAN + RS-485 schematic), and the **PCB layout** silkscreen.
Open `esp32-pcb-functions.drawio` in [draw.io](https://app.diagrams.net) (File → Open,
or import into your Drive copy) to see the arranged flow.

> Pins read directly from the schematics are stated as-is. A few marked *(inferred)* come
> from the PCB silkscreen / ESP32-S3 defaults where the net wasn't fully legible.

## Functional blocks

### A. MCU core
- **ESP32-S3-WROOM-1 (N16R8)** — dual-core LX7, 16 MB flash, 8 MB PSRAM, Wi-Fi + BLE.
- Decoupling: **C2 10 µF**, **C10 0.1 µF**, **C4 0.1 µF**.

### B. System / boot
- **Reset** — `EN` pin, **R13 10 kΩ** pull-up, **RST** button (K2-3.8×6.1), C4 0.1 µF.
- **Boot / download** — `IO0`, **R20 10 kΩ** pull-up, **PROG** button, net `MCU_PROG`.
- **JTAG / debug** — `MTDI(IO42)`, `MTDO(IO41)`, `MTCK(IO40)`, `JTAG_EN`.

### C. Power
- **PWR 12 V** input (`IN+ / IN-`), **BAT** B+ backup, rails **12 V → 5 V → 3.3 V**.

### D. Communication
1. **CAN bus** — `SN65HVD230DR`; `D(TX)=GPIO14`, `R(RX)=GPIO13`, `RS=R22 10 kΩ` (slope),
   `C27 0.1 µF`, **J1 + R39 120 Ω** termination → `CAN_H / CAN_L`.
2. **RS-485** — `MAX3485EESA`; `DI=TXD0`, `RO=RXD0`, `DE+RE#=GPIO10` (`R36 10 kΩ` pull-up),
   `C26 0.1 µF`, **J2 + R29 120 Ω** termination → `A / B`.
3. **4G modem** — cellular over **UART1** (`TX1=IO17 / RX1`), `4G-UART` header.
4. **LoRa E220-900** — UART (`43TX / 44RX`), `M0/M1`, `AUX`, 3.3 V.
5. **USB (native)** — `DN-(IO19) / DP+(IO20)` — programming + UART bridge.
6. **I²C** — `SDA / SCL` → LCD / sensors.

### E. Field I/O
- **DI** — opto-isolated digital inputs.
- **DO** — `DO1 / DO2` @ 12 V (relay/opto outputs).
- **CT** — current-transformer input (ADC).
- **TM1** — TM16xx LED/key driver or terminal bus.

### F. HMI / storage
- **LCD** (I²C), **SD card** (`MCU_nSD_CARD`).
- **Status LEDs** — GREEN `GPIO47` (R3 4.7 kΩ), RED `GPIO48` (R9 4.7 kΩ).

## GPIO / net map

| ESP32-S3 pin | Net | Function |
| --- | --- | --- |
| GPIO13 | `MCU_GPIO_13` | CAN RX (SN65 `R`) |
| GPIO14 | `MCU_GPIO_14` | CAN TX (SN65 `D`) |
| GPIO10 | `MCU_GPIO_10` | RS-485 `DE/RE#` direction |
| TXD0 *(GPIO43, inferred)* | `MCU_TX0` | RS-485 `DI` / UART0 TX |
| RXD0 *(GPIO44, inferred)* | `MCU_RX0` | RS-485 `RO` / UART0 RX |
| TX1 (GPIO17) | `MCU_TX1` | UART1 (4G / LoRa) |
| RX1 | `MCU_RX1` | UART1 |
| SDA / SCL | `MCU_SDA` / `MCU_SCL` | I²C (LCD) |
| GPIO19 / GPIO20 | `MCU_DN(-)` / `MCU_DP(+)` | USB D- / D+ |
| GPIO42 / 41 / 40 | `MCU_MTDI/MTDO/MTCK` | JTAG |
| GPIO0 | `MCU_PROG` | boot / download |
| EN | — | reset |
| GPIO47 / GPIO48 | `MCU_GPIO47/48` | green / red LED |
| GPIO45 *(inferred)* | `MCU_nSD_CARD` | SD card |
| GPIO06/07/08/09/11/12 | `MCU_GPIO_06…12` | DI / DO / CT / TM1 *(field I/O, inferred grouping)* |
| GPIO35–38 | `MCU_GPIO_35…38` | DI / DO *(inferred grouping)* |

## Flow summary (how each function connects to the MCU)

```
        RESET(EN) ─┐                              ┌─ CAN  ⇄ SN65HVD230 ⇄ CAN_H/L (120Ω)
        BOOT(IO0) ─┤                              ├─ RS485⇄ MAX3485    ⇄ A/B    (120Ω)
        JTAG ──────┤        ESP32-S3-WROOM-1      ├─ 4G   ⇄ UART1
   12V→5V→3.3V ────┼──────►   (N16R8 core)   ◄────┼─ LoRa ⇄ E220-900
                   │                              ├─ USB  ⇄ DN-/DP+
                   │                              ├─ I2C  ⇄ LCD
        DI ⇄ GPIO ─┤                              ├─ SD   ⇄ nSD_CARD
   DO1/DO2 ⇄ GPIO ─┤                              └─ LEDs   GPIO47/48
     CT ⇄ ADC ─────┤
   TM1 ⇄ GPIO ─────┘
```
