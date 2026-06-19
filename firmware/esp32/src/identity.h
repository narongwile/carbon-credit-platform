#pragma once
#include <Arduino.h>

// ===========================================================================
//  Device identity & provisioning (spec §2/§13/§19).
//  Values are read from NVS first (zero-touch provisioning); if absent we fall
//  back to the compile-time defaults in config.h so a bench unit still boots.
// ===========================================================================
struct OoIdentity {
  String tenant;
  String product;
  String device;
  String fw;
  String topicPrefix;     // P = [root/]{tenant}/{product}/{device}
  String clientId;        // {tenant}.{product}.{device}  (== cert CN in prod)
  bool   provisioned;     // true if identity + cert came from NVS
};

// mTLS material (PEM). Empty strings => server-auth TLS only (dev).
struct OoCerts {
  String ca;
  String clientCert;
  String clientKey;
  bool   haveClient;      // true => mutual TLS (spec §2)
};

void              ooIdentityInit();
const OoIdentity& ooId();
const OoCerts&    ooCerts();

// Runtime config persisted in NVS (sample rate, cfg_v) — spec §25.
uint32_t ooCfgSampleMs();
void     ooCfgSetSampleMs(uint32_t ms);
uint32_t ooCfgVersion();
void     ooCfgSetVersion(uint32_t v);
