#include "transport.h"
#include <WiFi.h>

// switch-up dwell per transport (ms): Wi-Fi 20 s, 4G 30 s, LoRa floor (spec §21)
static const uint32_t DWELL[3] = {20000, 30000, 0};
static uint64_t stableSince[3] = {0, 0, 0};
static OoTr     current = TR_NONE;

// Default radio hooks — false until a 4G/LoRa driver overrides them.
bool __attribute__((weak)) ooCellAvailable() { return false; }
bool __attribute__((weak)) ooLoRaAvailable() { return false; }

static bool available(OoTr t) {
  switch (t) {
    case TR_WIFI: return WiFi.status() == WL_CONNECTED;
    case TR_CELL: return ooCellAvailable();
    case TR_LORA: return ooLoRaAvailable();
    default:      return false;
  }
}

void ooTransportInit() { current = TR_NONE; for (int i = 0; i < 3; i++) stableSince[i] = 0; }

OoTr ooTransportSelect(uint64_t now) {
  for (int i = 0; i < 3; i++) {
    if (available((OoTr)i)) { if (stableSince[i] == 0) stableSince[i] = now; }
    else stableSince[i] = 0;
  }
  // switch DOWN immediately if the current link dropped
  if (current != TR_NONE && !available(current)) current = TR_NONE;

  // pick the highest-rank link that has been stable for its dwell; a strictly
  // better link must clear the dwell before we switch UP to it.
  for (int i = 0; i < 3; i++) {
    if (!available((OoTr)i)) continue;
    bool dwellOk = (now - stableSince[i]) >= DWELL[i];
    if (current == TR_NONE) { if (dwellOk || i == TR_LORA) { current = (OoTr)i; break; } }
    else if (i < (int)current && dwellOk) { current = (OoTr)i; break; }   // upgrade
    else if (i == (int)current) break;                                    // keep current
  }
  return current;
}

const char* ooTransportName(OoTr t) {
  switch (t) { case TR_WIFI: return "wifi"; case TR_CELL: return "4g"; case TR_LORA: return "lora"; default: return "none"; }
}
