#pragma once
#include <Arduino.h>

// ===========================================================================
//  Transport selection + anti-flap hysteresis (spec §15/§21). Ranks Wi-Fi >
//  4G > LoRa: switches DOWN immediately on loss, but only switches UP to a
//  higher-rank link after it has been continuously available for a dwell.
//
//  Wi-Fi is concrete here. ooCellAvailable()/ooLoRaAvailable() are weak hooks
//  returning false — wire them to TinyGSM / an SX127x LoRa driver to light up
//  4G/LoRa (the radio drivers need their vendor libraries + hardware).
// ===========================================================================
enum OoTr { TR_WIFI = 0, TR_CELL = 1, TR_LORA = 2, TR_NONE = 3 };

void        ooTransportInit();
OoTr        ooTransportSelect(uint64_t nowMs);   // applies hysteresis
const char* ooTransportName(OoTr t);

// Radio availability hooks (override in a 4G/LoRa build).
bool ooCellAvailable();
bool ooLoRaAvailable();
