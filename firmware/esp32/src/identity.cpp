#include "identity.h"
#include "config.h"
#include <Preferences.h>

static OoIdentity gId;
static OoCerts    gCerts;
static Preferences gNvs;
static volatile uint32_t gSampleMs = 1500;   // RAM cache of the config sample rate

static String nvsStr(const char* key, const char* dflt) {
  String v = gNvs.getString(key, "");
  return v.length() ? v : String(dflt);
}

void ooIdentityInit() {
  gNvs.begin(OO_NVS_NS, /*readOnly=*/false);

  gId.tenant  = nvsStr("tenant",  OO_TENANT);
  gId.product = nvsStr("product", OO_PRODUCT);
  gId.device  = nvsStr("device",  OO_DEVICE_ID);
  gId.fw      = OO_FW_VERSION;

  String p;
  if (strlen(OO_TOPIC_ROOT)) { p += OO_TOPIC_ROOT; p += "/"; }
  p += gId.tenant + "/" + gId.product + "/" + gId.device;
  gId.topicPrefix = p;
  gId.clientId    = gId.tenant + "." + gId.product + "." + gId.device;  // cert CN

  // mTLS material (provisioned). CA may be a compiled bundle in a real build.
  gCerts.ca         = gNvs.getString("ca",   "");
  gCerts.clientCert = gNvs.getString("cert", "");
  gCerts.clientKey  = gNvs.getString("key",  "");
  gCerts.haveClient = gCerts.clientCert.length() && gCerts.clientKey.length();

  gId.provisioned = gNvs.getString("cert", "").length() > 0;

  // Seed sample-rate default once, then load into the RAM cache.
  if (!gNvs.isKey("sample_ms"))
    gNvs.putUInt("sample_ms", OO_SAMPLE_MS ? OO_SAMPLE_MS : 1500);
  gSampleMs = gNvs.getUInt("sample_ms", OO_SAMPLE_MS ? OO_SAMPLE_MS : 1500);
}

const OoIdentity& ooId()    { return gId; }
const OoCerts&    ooCerts() { return gCerts; }

uint32_t ooCfgSampleMs()            { return gSampleMs; }   // RAM cache (no flash read per loop)
void     ooCfgSetSampleMs(uint32_t ms) { if (ms >= 200 && ms <= 600000) { gSampleMs = ms; gNvs.putUInt("sample_ms", ms); } }
uint32_t ooCfgVersion()             { return gNvs.getUInt("cfg_v", 0); }
void     ooCfgSetVersion(uint32_t v){ gNvs.putUInt("cfg_v", v); }
