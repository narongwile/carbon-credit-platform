#pragma once
// ===========================================================================
//  4G modem bring-up (TinyGSM). Provides the STRONG ooCellAvailable() override
//  used by the transport hysteresis (transport.cpp) so the device can fail over
//  to cellular when Wi-Fi drops. Guarded by OO_HAVE_TINYGSM (config.h) so the
//  firmware still compiles without the library.
//
//  Scope: brings the modem online, reports availability, and exposes the
//  TinyGSM TCP client so net_mqtt.cpp can route the MQTT session over 4G when
//  the transport hysteresis selects cellular (ooMqttSetTransport / spec §21).
// ===========================================================================
#include <Client.h>

void ooCellInit();

// The modem's TCP(/TLS) client, ready for MQTTClient::begin(). Returns nullptr
// when this build has no cellular radio (OO_HAVE_TINYGSM == 0).
Client* ooCellClient();
