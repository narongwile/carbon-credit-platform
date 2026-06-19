#include "store.h"
#include "config.h"
#include "oneops.h"
#include <LittleFS.h>

static const char* PATH = "/buf.ndjson";
static bool gReady = false;

void ooStoreInit() {
#if OO_STORE_ENABLE
  // mount the dedicated `storage` partition (spec §20), not the default "spiffs"
  gReady = LittleFS.begin(/*formatOnFail=*/true, "/littlefs", 5, "storage");
#endif
}

// Each record: "<topicSuffix>\t<json>\n"
bool ooStoreAppend(const char* topicSuffix, const char* json, size_t len) {
#if OO_STORE_ENABLE
  if (!gReady) return false;
  File f = LittleFS.open(PATH, "a");
  if (!f) return false;
  if (f.size() > OO_STORE_MAX) { f.close(); return false; }   // cap: stop appending oldest survives
  f.print(topicSuffix); f.write('\t');
  f.write((const uint8_t*)json, len); f.write('\n');
  f.close();
  return true;
#else
  (void)topicSuffix; (void)json; (void)len; return false;
#endif
}

size_t ooStorePending() {
#if OO_STORE_ENABLE
  if (!gReady) return 0;
  File f = LittleFS.open(PATH, "r");
  size_t s = f ? f.size() : 0; if (f) f.close(); return s;
#else
  return 0;
#endif
}

size_t ooStoreReplay() {
#if OO_STORE_ENABLE
  if (!gReady) return 0;
  File f = LittleFS.open(PATH, "r");
  if (!f) return 0;
  size_t n = 0;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    int tab = line.indexOf('\t');
    if (tab <= 0) continue;
    String suffix = line.substring(0, tab);
    String json   = line.substring(tab + 1);
    if (ooEnqueue(suffix.c_str(), json.c_str(), json.length(), /*qos*/1, false, /*prio*/0)) n++;
    else break;                                   // egress full — keep the rest for next time
  }
  bool drainedAll = !f.available();
  f.close();
  if (drainedAll) LittleFS.remove(PATH);          // all replayed -> clear
  return n;
#else
  return 0;
#endif
}
