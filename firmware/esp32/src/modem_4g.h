#pragma once
// ===========================================================================
//  4G modem bring-up (TinyGSM). Provides the STRONG ooCellAvailable() override
//  used by the transport hysteresis (transport.cpp) so the device can fail over
//  to cellular when Wi-Fi drops. Guarded by OO_HAVE_TINYGSM (config.h) so the
//  firmware still compiles without the library.
//
//  Scope: this brings the modem online and reports availability. Routing the
//  MQTT/TLS session itself over the modem (TinyGsmClient as the transport in
//  net_mqtt.cpp) is the remaining integration step — see README.
// ===========================================================================
void ooCellInit();
