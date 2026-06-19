#pragma once
// ===========================================================================
//  Board pin map — ESP32-S3-WROOM-1 (N16R8) carrier, read from the schematic
//  (Commu/CAN-485 sheet + MCU sheet).  [HIGH] = clearly legible on the sheet;
//  [VERIFY] = inferred / not fully legible — confirm against your board before
//  trusting the demo reads.
// ===========================================================================

// ---- CAN bus — SN65HVD230 (TWAI) -------------------------- [HIGH] ----------
#define OO_PIN_CAN_TX     14     // SN65 'D'  <- MCU_GPIO_14
#define OO_PIN_CAN_RX     13     // SN65 'R'  -> MCU_GPIO_13

// ---- RS-485 — MAX3485 (Modbus-RTU sensors) --------------- [HIGH] ----------
#define OO_PIN_RS485_TX   43     // DI  <- MCU_TX0 (UART0 TXD)
#define OO_PIN_RS485_RX   44     // RO  -> MCU_RX0 (UART0 RXD)
#define OO_PIN_RS485_DE   10     // DE+RE# tied -> MCU_GPIO_10  (R36 10k pull-up)

// ---- I2C — LCD / RTC / sensors --------------------------- [VERIFY] --------
#define OO_I2C_SDA        8      // MCU_SDA  (GPIO# not fully legible — verify)
#define OO_I2C_SCL        9      // MCU_SCL
#define OO_DS3231_ADDR    0x68

// ---- UART1 — 4G modem / LoRa E220-900 -------------------- [HIGH] ----------
#define OO_PIN_TX1        17     // MCU_TX1
#define OO_PIN_RX1        18     // MCU_RX1

// ---- Analog (ADC1 — usable with Wi-Fi) ------------------- [VERIFY] --------
#define OO_PIN_CT_ADC     4      // CT connector (current) -> load_pct
#define OO_PIN_BATT_ADC   5      // battery divider -> batt_pct
#define OO_ADC_BATT_DIV   2.0f   // external divider ratio (Vbat = Vadc * div)

// ---- Digital I/O ----------------------------------------- [VERIFY] --------
#define OO_PIN_DOOR_DI    11     // DI connector (door switch), INPUT_PULLUP
#define OO_DOOR_ACTIVE_LOW 1     // 1 => LOW means "door open"
#define OO_PIN_DO1        12     // DO1 (12 V driver)
#define OO_PIN_DO2        21     // DO2 (12 V driver)

// ---- Status LEDs ----------------------------------------- [HIGH] ----------
#define OO_LED_GREEN      47     // MCU_GPIO47 (R3 4.7k)
#define OO_LED_RED        48     // MCU_GPIO48 (R9 4.7k)

// ---- Storage --------------------------------------------- [HIGH] ----------
#define OO_PIN_SD_CS      45     // MCU_nSD_CARD

// ---- Sensor I2C addresses (common parts; change per BOM) -------------------
#define OO_ADDR_SHT3X     0x44   // temperature + humidity
#define OO_ADDR_BMP280    0x76   // barometric pressure -> altitude
#define OO_ADDR_ADXL345   0x53   // accelerometer -> impact (g)

// ---- Modbus (RS-485) sensor map (holding regs, value = reg/10) -------------
#define OO_MODBUS_SLAVE   1
#define OO_MODBUS_BAUD    9600
