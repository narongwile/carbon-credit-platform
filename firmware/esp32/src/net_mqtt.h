#pragma once
#include <Arduino.h>

// ===========================================================================
//  Connectivity + MQTT (spec §1/§5/§6/§7/§15). Only this module touches the
//  MQTT client; everything else hands work to the egress queue (oneops.h).
//
//  Transport: Wi-Fi is implemented (rank 0). 4G/LoRa are documented hooks —
//  ooTransport()/the hysteresis fields are the integration point (spec §21);
//  their radio drivers are out of scope for this carrier build (see README).
// ===========================================================================
void        ooNetInit();             // Wi-Fi + TLS/mTLS + MQTT client setup
bool        ooMqttConnected();
void        ooMqttService();         // call from MqttTask: loop() + drain egress
void        ooMqttGracefulSleep();   // retained "asleep" + clean DISCONNECT (MQTT task only)
const char* ooTransport();           // "wifi" (active) | "none"
int         ooRssi();
