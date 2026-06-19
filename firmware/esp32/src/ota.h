#pragma once
#include <Arduino.h>

// ===========================================================================
//  A/B OTA with rollback (spec §4/§24). Runs in its own FreeRTOS task so the
//  long HTTPS download never blocks MQTT draining. Progress is reported back
//  through the egress queue (P/ota/progress).
// ===========================================================================
void ooOtaInit();                    // boot-time: confirm or arm rollback
void ooOtaConfirmHealthy();          // call after self-test passes (cancels rollback)
void ooOtaTaskStart();               // create OtaTask
void ooOtaSubmit(const char* descriptorJson, size_t len);  // from MQTT downlink
