#pragma once
#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

// ===========================================================================
//  Shared contracts for the FreeRTOS task split (spec §14).
//
//  Sensor and alarm tasks NEVER touch the MQTT client directly (the MQTT lib is
//  not thread-safe). They enqueue an EgressMsg on a single priority egress
//  queue; only MqttTask drains and publishes — Alarm (QoS 1) before Telemetry.
// ===========================================================================

// Topic suffix is relative to the device prefix P unless `absolute` is set.
struct EgressMsg {
  char     topic[96];     // suffix under P/, or absolute topic if `absolute`
  char     payload[480];  // serialized JSON
  uint16_t len;
  uint8_t  qos;           // 0 | 1
  bool     retain;
  bool     absolute;      // topic is already fully-qualified (compat mode)
  uint8_t  prio;          // 0 = telemetry, 1 = alarm/diag (drained first)
};

// Two FreeRTOS queues give a strict 2-level priority (alarm drained before
// telemetry) without a full priority queue. Created in main.
extern QueueHandle_t gEgressHi;   // alarms, status, diag  (prio 1)
extern QueueHandle_t gEgressLo;   // telemetry, heartbeat  (prio 0)

// Enqueue helper (non-blocking; drops oldest-telemetry on overflow — spec §14).
bool ooEnqueue(const char* topicSuffix, const char* payload, size_t len,
               uint8_t qos, bool retain, uint8_t prio, bool absolute = false);

// Severity for the edge fast-path (spec §8/§9).
enum OoSeverity { OO_NORMAL = 0, OO_WARNING = 1, OO_CRITICAL = 2 };
const char* ooSeverityName(OoSeverity s);
