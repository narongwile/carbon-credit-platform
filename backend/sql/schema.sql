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
  lat           DECIMAL(10,7),  -- geo for the live sensor map
  lng           DECIMAL(10,7),
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

-- Tenancy / RBAC data model (provisioned by superadmin; managed by admin).
-- Enforcement (auth guard) lands with the JWT auth work; these are the tables.
CREATE TABLE IF NOT EXISTS organizations (
  id         VARCHAR(64) PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  status     ENUM('active','suspended') DEFAULT 'active',
  logo_url   TEXT,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS departments (
  id     VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL,
  name   VARCHAR(120) NOT NULL,
  INDEX (org_id)
);

-- Platform licensing per org (presence of a row = licensed)
CREATE TABLE IF NOT EXISTS org_entitlements (
  org_id   VARCHAR(64) NOT NULL,
  platform VARCHAR(40) NOT NULL,
  PRIMARY KEY (org_id, platform)
);

-- Product access: department→domain (admin grant) and user→domain (override)
CREATE TABLE IF NOT EXISTS product_access (
  scope    ENUM('department','user') NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  domain   VARCHAR(32) NOT NULL,
  level    ENUM('none','view','manage') NOT NULL DEFAULT 'view',
  PRIMARY KEY (scope, scope_id, domain)
);

-- Event problem catalog (root causes) — admin maintains per org/department/domain;
-- viewers pick one when acknowledging (alarm_events.event_problem_id).
CREATE TABLE IF NOT EXISTS event_problems (
  id            VARCHAR(64) PRIMARY KEY,
  org_id        VARCHAR(64) NOT NULL,
  department_id VARCHAR(64),
  domain        VARCHAR(32),
  label         VARCHAR(200) NOT NULL,
  created_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (org_id, department_id), INDEX (domain)
);

-- Users + per-user preferences (configProfile). Identity is the x-user-id
-- header for now (pre-auth); swap for JWT subject when auth lands.
CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(64) PRIMARY KEY,
  org_id        VARCHAR(64) NOT NULL,
  email         VARCHAR(160),
  name          VARCHAR(120),
  role          VARCHAR(32),
  department_id VARCHAR(64),
  password_hash VARCHAR(120),
  created_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (org_id), UNIQUE KEY uq_email (email)
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id    VARCHAR(64) PRIMARY KEY,
  prefs      TEXT,
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

-- Device logs (P/diag/log + P/ota/progress)
CREATE TABLE IF NOT EXISTS device_logs (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  node_id   VARCHAR(64) NOT NULL,
  kind      ENUM('diag','ota') NOT NULL DEFAULT 'diag',
  level     VARCHAR(32),
  payload   TEXT,
  ts        DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (node_id, ts)
);

-- Scheduled reports (cron-generated CSV emailed to recipients)
CREATE TABLE IF NOT EXISTS report_schedules (
  id           VARCHAR(64) PRIMARY KEY,
  org_id       VARCHAR(64) NOT NULL,
  name         VARCHAR(160) NOT NULL,
  scope        ENUM('device','department','org') NOT NULL DEFAULT 'device',
  scope_id     VARCHAR(64),
  sequence     ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'daily',
  format       ENUM('PDF','XLSX','CSV') NOT NULL DEFAULT 'CSV',
  recipients   VARCHAR(500),          -- comma-separated emails
  enabled      TINYINT(1) DEFAULT 1,
  last_run_at  DATETIME(3) NULL,
  next_run_at  DATETIME(3) NULL,
  INDEX (org_id), INDEX (enabled, next_run_at)
);

-- Dead-letter — anything the global catch node (or Express error mw) couldn't process
CREATE TABLE IF NOT EXISTS dead_letter (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  source     VARCHAR(120),
  error      VARCHAR(500),
  payload    TEXT,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

-- Downsampled hourly rollup of raw readings (retention keeps the table lean)
CREATE TABLE IF NOT EXISTS readings_rollup (
  node_id   VARCHAR(64) NOT NULL,
  param_key VARCHAR(40) NOT NULL,
  bucket    DATETIME(3) NOT NULL,
  n         INT,
  v_avg     DECIMAL(12,4),
  v_min     DECIMAL(12,4),
  v_max     DECIMAL(12,4),
  PRIMARY KEY (node_id, param_key, bucket)
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
