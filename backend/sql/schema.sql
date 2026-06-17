-- ONEOPS IoT Hub schema (MySQL 8)
CREATE DATABASE IF NOT EXISTS iothub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE iothub;

-- Sensor nodes (mirror of fleet hosts; org/department scoped)
CREATE TABLE IF NOT EXISTS nodes (
  id            VARCHAR(64) PRIMARY KEY,
  org_id        VARCHAR(64) NOT NULL,
  site_id       VARCHAR(64),
  department_id VARCHAR(64),
  domain        ENUM('transformer','carbonNode','bloodBox') NOT NULL,
  name          VARCHAR(120) NOT NULL,
  mqtt_prefix   VARCHAR(255),   -- device topic prefix P (for downlink config/cmd/ota)
  INDEX (org_id), INDEX (department_id), INDEX (domain)
);

-- Per-node alarm rule (engine config) stored as JSON
CREATE TABLE IF NOT EXISTS alarm_rules (
  node_id     VARCHAR(64) PRIMARY KEY,
  org_id      VARCHAR(64) NOT NULL,
  domain      VARCHAR(32) NOT NULL,
  rule_json   JSON NOT NULL,
  updated_by  VARCHAR(120),
  updated_at  DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX (org_id)
);

-- Raw telemetry (partition-friendly; one row per reading per parameter)
CREATE TABLE IF NOT EXISTS readings (
  node_id   VARCHAR(64) NOT NULL,
  param_key VARCHAR(40) NOT NULL,
  value     DECIMAL(12,3) NOT NULL,
  taken_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (node_id, param_key, taken_at)
);

-- Alarm events emitted by the engine
CREATE TABLE IF NOT EXISTS alarm_events (
  id           VARCHAR(160) PRIMARY KEY,
  node_id      VARCHAR(64) NOT NULL,
  org_id       VARCHAR(64) NOT NULL,
  department_id VARCHAR(64),
  param_key    VARCHAR(40) NOT NULL,
  param_label  VARCHAR(80) NOT NULL,
  severity     ENUM('WARNING','CRITICAL') NOT NULL,
  kind         ENUM('threshold','rate','offline') NOT NULL,
  value        DECIMAL(12,3) NOT NULL,
  threshold    DECIMAL(12,3) NOT NULL,
  unit         VARCHAR(16),
  raised_at    DATETIME(3) NOT NULL,
  acknowledged_at DATETIME(3) NULL,
  acknowledged_by VARCHAR(120) NULL,
  event_problem_id VARCHAR(64) NULL,
  notified     TINYINT(1) DEFAULT 0,
  escalated    TINYINT(1) DEFAULT 0,
  cleared_at   DATETIME(3) NULL,
  INDEX (node_id), INDEX (org_id), INDEX (severity), INDEX (acknowledged_at), INDEX (cleared_at)
);

-- Department-scoped node documents
CREATE TABLE IF NOT EXISTS documents (
  id           VARCHAR(64) PRIMARY KEY,
  node_id      VARCHAR(64) NOT NULL,
  department_id VARCHAR(64) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  size         VARCHAR(32),
  uploaded_by  VARCHAR(120),
  data         LONGBLOB,
  created_at   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (node_id, department_id)
);

-- Notification channel config per org/department
CREATE TABLE IF NOT EXISTS notification_channels (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id      VARCHAR(64) NOT NULL,
  department_id VARCHAR(64),
  channel     ENUM('email','line','telegram','googlechat') NOT NULL,
  target      VARCHAR(255),
  min_severity ENUM('WARNING','CRITICAL') DEFAULT 'WARNING',
  enabled     TINYINT(1) DEFAULT 1,
  INDEX (org_id)
);

-- Device presence / liveness (driven by ESP32 heartbeat + status birth/will)
CREATE TABLE IF NOT EXISTS device_presence (
  node_id     VARCHAR(64) PRIMARY KEY,
  online      TINYINT(1) DEFAULT 1,
  last_seen   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  rssi        SMALLINT,
  batt        TINYINT,
  fw          VARCHAR(32),
  INDEX (online, last_seen)
);
