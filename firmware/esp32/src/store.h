#pragma once
#include <Arduino.h>

// ===========================================================================
//  Store-and-forward (spec §14). When the link is down, telemetry is appended
//  to a LittleFS NDJSON ring file instead of being lost; on reconnect it is
//  replayed into the egress queue. FIFO drop-oldest when the cap is hit.
// ===========================================================================
void   ooStoreInit();
bool   ooStoreAppend(const char* topicSuffix, const char* json, size_t len);
size_t ooStorePending();                         // bytes buffered
// Replay everything into the egress queue (ooEnqueue) and clear the buffer.
size_t ooStoreReplay();
