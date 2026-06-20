#include "modem_4g.h"
#include "config.h"
#include "transport.h"

#if OO_HAVE_TINYGSM
// Select the modem model for your board's 4G-UART header BEFORE including
// TinyGsmClient.h (e.g. SIM7600, A7670, SIM800). Add `vshymanskyy/TinyGSM` to
// platformio lib_deps to enable this build.
#ifndef TINY_GSM_MODEM_SIM7600
#define TINY_GSM_MODEM_SIM7600
#endif
#include <Arduino.h>
#include <TinyGsmClient.h>
#include "board_pins.h"

// UART0 controller remapped to the 4G-UART header pins (Serial=USB-CDC frees it).
// [VERIFY] pins/UART against the board — RS485 uses UART1, GPS uses UART2.
static HardwareSerial SerialAT(0);
static TinyGsm        modem(SerialAT);
static bool           gReady = false;

void ooCellInit() {
  SerialAT.begin(115200, SERIAL_8N1, OO_PIN_RX1, OO_PIN_TX1);
  delay(100);
  if (!modem.restart()) { gReady = false; return; }
  modem.gprsConnect(OO_GSM_APN, OO_GSM_USER, OO_GSM_PASS);
  gReady = true;
}

// Strong definition — overrides the weak `return false` stub in transport.cpp.
bool ooCellAvailable() {
  return gReady && modem.isNetworkConnected() && modem.isGprsConnected();
}

#else  // ---- OO_HAVE_TINYGSM == 0 : no cellular radio in this build ----------

void ooCellInit() {}   // ooCellAvailable() stays the weak `false` stub (transport.cpp)

#endif
