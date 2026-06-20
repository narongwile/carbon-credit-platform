#pragma once
#include <Arduino.h>
#include "transport.h"

// ===========================================================================
//  Connectivity + MQTT (spec §1/§5/§6/§7/§15). Only this module touches the
//  MQTT client; everything else hands work to the egress queue (oneops.h).
//
//  Transport: Wi-Fi (rank 0) is concrete; 4G (rank 1) is routed over the
//  TinyGSM client when OO_HAVE_TINYGSM is set and the hysteresis selects it.
//  The MqttTask owns selection and calls ooMqttSetTransport() (spec §21).
// ===========================================================================
void        ooNetInit();             // Wi-Fi + TLS/mTLS + MQTT client setup
bool        ooMqttConnected();
void        ooMqttService();         // call from MqttTask: loop() + drain egress
void        ooMqttSetTransport(OoTr t); // bind the MQTT session to Wi-Fi / 4G (MQTT task only)
void        ooMqttGracefulSleep();   // retained "asleep" + clean DISCONNECT (MQTT task only)
const char* ooTransport();           // "wifi" | "4g" | "none" (active link)
int         ooRssi();
