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
#define OO_CAN_BITRATE_K  500    // 500 kbit/s field bus
// Demo CAN sensor IDs (data[0..1] = int16 BE, value = raw/10) — match the sensor.
#define OO_CAN_ID_DGA     0x201  // dissolved-H2 analyser on CAN
#define OO_CAN_ID_AMBIENT 0x202  // ambient temperature on CAN

// ---- RS-485 — MAX3485 (Modbus-RTU sensors) --------------- [HIGH] ----------
#define OO_PIN_RS485_TX   43     // DI  <- MCU_TX0 (UART0 TXD)
#define OO_PIN_RS485_RX   44     // RO  -> MCU_RX0 (UART0 RXD)
#define OO_PIN_RS485_DE   10     // DE+RE# tied -> MCU_GPIO_10  (R36 10k pull-up)

// ---- I2C — LCD / RTC / sensors --------------------------- [VERIFY] --------
// From the MCU sheet right column: MCU_SDA = module pin 39 = IO1, MCU_SCL =
// module pin 38 = IO2 (ESP32-S3-WROOM-1 pinout). Verify on your board.
#define OO_I2C_SDA        1      // MCU_SDA  (GPIO1)
#define OO_I2C_SCL        2      // MCU_SCL  (GPIO2)
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
#define OO_PIN_COMPRESSOR 12     // DI: compressor relay/contact sense (carbonbox)
#define OO_PIN_DO1        38     // DO1 (12 V driver)  (MCU_GPIO_37 area)
#define OO_PIN_DO2        39     // DO2 (12 V driver)  (MCU_GPIO_38 area)

// ---- GPS (bloodbox outdoor transit) — UART2 -------------- [VERIFY] --------
// Likely multiplexed with the 4G-UART header (one of GPS/4G at a time). Set to
// the real GPS UART pins on your board.
#define OO_PIN_GPS_RX     16
#define OO_PIN_GPS_TX     15
#define OO_GPS_BAUD       9600

// ---- Status LEDs ----------------------------------------- [HIGH] ----------
#define OO_LED_GREEN      47     // MCU_GPIO47 (R3 4.7k)
#define OO_LED_RED        48     // MCU_GPIO48 (R9 4.7k)

// ---- Storage --------------------------------------------- [HIGH] ----------
#define OO_PIN_SD_CS      45     // MCU_nSD_CARD

// ---- Sensor I2C parts (real models; addresses change per BOM) --------------
#define OO_ADDR_SHT31     0x44   // Sensirion SHT31 temp+RH (bloodbox); 0x45 alt
#define OO_ADDR_TMP117    0x48   // TI TMP117 precision temp (carbonbox cold-chain probe)
#define OO_ADDR_BMP280    0x76   // Bosch BMP280 pressure -> altitude (bloodbox); 0x77 alt
#define OO_ADDR_ADXL345   0x53   // Analog Devices ADXL345 accel -> impact g (bloodbox)
#define OO_PIN_IMU_INT    6      // ADXL345 INT1 -> ESP32 (RTC GPIO for ext0 deep-sleep wake) [VERIFY]

// ---- Modbus (RS-485) sensor map (holding regs, value = reg/10) -------------
#define OO_MODBUS_SLAVE   1
#define OO_MODBUS_BAUD    9600
