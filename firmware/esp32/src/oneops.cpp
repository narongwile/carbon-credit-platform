#include "oneops.h"
#include "config.h"
#include <string.h>

QueueHandle_t gEgressHi = nullptr;
QueueHandle_t gEgressLo = nullptr;

const char* ooSeverityName(OoSeverity s) {
  switch (s) { case OO_CRITICAL: return "CRITICAL"; case OO_WARNING: return "WARNING"; default: return "NORMAL"; }
}

bool ooEnqueue(const char* topicSuffix, const char* payload, size_t len,
               uint8_t qos, bool retain, uint8_t prio, bool absolute) {
  if (len >= sizeof(EgressMsg::payload)) return false;         // too large — caller must split
  EgressMsg m{};
  strncpy(m.topic, topicSuffix, sizeof(m.topic) - 1);
  memcpy(m.payload, payload, len);
  m.len = (uint16_t)len;
  m.qos = qos; m.retain = retain; m.absolute = absolute; m.prio = prio;

  QueueHandle_t q = prio ? gEgressHi : gEgressLo;
  if (q == nullptr) return false;
  if (xQueueSend(q, &m, 0) == pdTRUE) return true;

  // Overflow policy (spec §14): NEVER drop alarms; for telemetry drop the
  // OLDEST to make room for the newest (FIFO drop-oldest).
  if (prio == 0) {
    EgressMsg dropped;
    xQueueReceive(q, &dropped, 0);
    return xQueueSend(q, &m, 0) == pdTRUE;
  }
  return false;
}
