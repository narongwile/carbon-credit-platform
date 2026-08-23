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
  -- Onboarding lifecycle: 'active' = provisioned/approved; 'pending' = auto-
  -- registered on first telemetry, awaiting admin approval; 'rejected' = ignored.
  status        ENUM('pending','active','rejected') NOT NULL DEFAULT 'active',
  first_seen    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (org_id), INDEX (department_id), INDEX (domain), INDEX (status)
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

-- Org+domain default rule / telemetry param set. Set at provision time (before any
-- device exists) and used to seed a node's alarm_rules the moment it is approved
-- (zero-touch) or manually provisioned.
CREATE TABLE IF NOT EXISTS org_domain_rules (
  org_id        VARCHAR(64) NOT NULL,
  domain        VARCHAR(32) NOT NULL,
  rule_json     JSON NOT NULL,
  debounce_json JSON,
  updated_by    VARCHAR(120),
  updated_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (org_id, domain)
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
  -- 'edge' = the firmware evaluated and reported this itself (P/alarm/{sid});
  -- 'cloud' = the ingest engine derived it from a reading. See migrate-v50.
  source       ENUM('edge','cloud') NOT NULL DEFAULT 'cloud',
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
  content_type VARCHAR(100),   -- MIME type so downloads open correctly (PDF, image, …)
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
  lat        DECIMAL(10,7),
  lng        DECIMAL(10,7),
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

-- Global platform config (superadmin-managed), e.g. SMTP sender/relay. Key-value
-- so new settings are data-only. Secrets (smtp.pass) are stored AES-GCM encrypted.
CREATE TABLE IF NOT EXISTS platform_settings (
  skey       VARCHAR(64) PRIMARY KEY,
  sval       TEXT,
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

-- Claimable pool for devices whose MQTT topic org is unknown. Suspended so it is
-- never a real tenant; the worker registers orphan pending nodes here and only a
-- superadmin can see and reassign them to a real org during approval.
INSERT IGNORE INTO organizations (id, name, status) VALUES ('__unassigned__', 'Unassigned / Pending Claim', 'suspended');

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
  phone         VARCHAR(40),
  role          VARCHAR(32),
  department_id VARCHAR(64),
  password_hash VARCHAR(120),
  created_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (org_id), UNIQUE KEY uq_email (email)
);

-- Employee directory (CSV allowlist uploaded by org admin).
-- Used to auto-assign self-registering users to the correct org + department.
CREATE TABLE IF NOT EXISTS org_directory (
  id            VARCHAR(64) PRIMARY KEY,
  org_id        VARCHAR(64) NOT NULL,
  name          VARCHAR(120),
  email         VARCHAR(160),
  phone         VARCHAR(40),
  department_id VARCHAR(64),
  created_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (org_id), INDEX (email), INDEX (phone), INDEX (name)
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id    VARCHAR(64) PRIMARY KEY,
  prefs      TEXT,
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

-- Factory floor-plan layout images (per org+floor). The heavy image bytes live
-- here (LONGBLOB) with a served path in image_url; pin positions / method stay in
-- user_prefs as small JSON. Avoids truncating a base64 image in a TEXT blob.
CREATE TABLE IF NOT EXISTS floorplans (
  org_id       VARCHAR(64) NOT NULL,
  floor_id     VARCHAR(64) NOT NULL,
  image_url    VARCHAR(512),   -- served path e.g. /api/orgs/{org}/floorplans/{floor}/image
  image_data   LONGBLOB,       -- raw image bytes (served by the image endpoint)
  content_type VARCHAR(100),
  updated_at   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (org_id, floor_id)
);

-- Password reset tokens (forgot password flow)
CREATE TABLE IF NOT EXISTS password_resets (
  token      VARCHAR(255) PRIMARY KEY,
  user_id    VARCHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used       TINYINT(1) DEFAULT 0,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (user_id)
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
  channel      ENUM('email','telegram') NOT NULL DEFAULT 'email',
  recipients   VARCHAR(500),          -- email(s) for channel=email, or Telegram chat id for channel=telegram
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
  -- Uptime tracking detects two physical devices publishing under one node id:
  -- MQTT hands a subscriber no publisher identity, so a repeated BACKWARDS jump
  -- in uptime is the only in-band evidence that more than one board is claiming
  -- this id (or that one is boot-looping). See migrate-v51.sql.
  last_uptime          BIGINT UNSIGNED NULL,
  uptime_regressions   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  uptime_window_start  DATETIME(3) NULL,
  identity_conflict_at DATETIME(3) NULL,
  last_sample JSON,   -- latest telemetry values (used by the pending-approval screen)
  INDEX (online, last_seen), INDEX (identity_conflict_at)
);
-- migrate-v9.sql — Firmware reliability + OTA + offline buffer support
USE iothub;

-- 1. OTA firmware releases (track available firmware per product/version)
CREATE TABLE IF NOT EXISTS ota_releases (
  id            VARCHAR(64) PRIMARY KEY,
  product       VARCHAR(40) NOT NULL,          -- eternity | carbonbox | bloodbox
  version       VARCHAR(32) NOT NULL,          -- semver: 1.5.0
  artefact_uri  TEXT NOT NULL,                 -- S3/GCS URL to signed binary
  sha256        CHAR(64),                      -- integrity check
  release_notes TEXT,
  is_mandatory  TINYINT(1) DEFAULT 0,          -- force update
  created_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_release (product, version),
  INDEX (product)
);

-- 2. OTA deployment tracking per device (status of each OTA push)
CREATE TABLE IF NOT EXISTS ota_deployments (
  id            VARCHAR(64) PRIMARY KEY,
  node_id       VARCHAR(64) NOT NULL,
  release_id    VARCHAR(64) NOT NULL,
  status        ENUM('pending','accepted','downloading','flashing',
                     'verifying','success','failed','rolled_back')
                NOT NULL DEFAULT 'pending',
  progress_pct  TINYINT DEFAULT 0,
  error_msg     VARCHAR(500),
  started_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  completed_at  DATETIME(3),
  INDEX (node_id), INDEX (release_id), INDEX (status)
);

-- 3. Offline buffer queue (store-and-forward: device uploads backlog after reconnect)
-- Node-RED ingest ควรเช็ค duplicate ด้วย node_id + param_key + taken_at PK
-- Table นี้ track ว่า device ส่ง backlog กี่ records, กี่ batch
CREATE TABLE IF NOT EXISTS offline_sync_log (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  node_id       VARCHAR(64) NOT NULL,
  batch_id      VARCHAR(64),                   -- device-generated batch UUID
  records_count INT NOT NULL DEFAULT 0,
  oldest_ts     DATETIME(3),                   -- oldest reading in batch
  newest_ts     DATETIME(3),                   -- newest reading in batch
  sync_at       DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (node_id, sync_at)
);

-- 4. Transport failover log (4G/LoRa/WiFi switch events — observability)
CREATE TABLE IF NOT EXISTS transport_events (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  node_id       VARCHAR(64) NOT NULL,
  from_transport ENUM('wifi','4g','lora','none') NOT NULL,
  to_transport   ENUM('wifi','4g','lora','none') NOT NULL,
  reason        VARCHAR(120),                  -- rssi_low, timeout, manual
  rssi          SMALLINT,
  ts            DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (node_id, ts)
);

-- 5. Edge alarm log (firmware-side debounced alarms, before cloud confirm)
-- ทำให้ดูได้ว่า device ตัดสินใจ alarm ก่อน cloud เมื่อไร
CREATE TABLE IF NOT EXISTS edge_alarm_log (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  node_id       VARCHAR(64) NOT NULL,
  param_key     VARCHAR(40) NOT NULL,
  severity      ENUM('WARNING','CRITICAL') NOT NULL,
  value         DECIMAL(12,3),
  threshold     DECIMAL(12,3),
  dwell_count   INT,                           -- จำนวน consecutive breach ก่อน fire
  ts            DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (node_id, ts)
);

-- 6. BloodBox transit telemetry queue (high-freq temp logging during transit)
-- เสริม blood_box_journey_events ที่เก็บ event-based,
-- table นี้เก็บ continuous temp logging ทุก 15s ระหว่างขนส่ง
CREATE TABLE IF NOT EXISTS blood_box_transit_telemetry (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  transit_id    VARCHAR(64) NOT NULL,
  box_id        VARCHAR(64),
  temp_c        DECIMAL(5,2) NOT NULL,
  rh_pct        DECIMAL(5,2),
  batt_pct      TINYINT,
  lat           DECIMAL(10,7),
  lng           DECIMAL(10,7),
  transport     ENUM('wifi','4g','lora') DEFAULT 'wifi',
  ts            DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (transit_id, ts), INDEX (box_id, ts)
);

-- 7. Alarm debounce config (per-product door/event debounce settings)
-- ใช้ทั้ง edge (firmware) และ cloud (Node-RED ingest)
-- NOTE: plain ADD COLUMN (no "IF NOT EXISTS" — that is MariaDB-only syntax and
-- errors on MySQL 8.x). The migrate.ts runner tolerates ER_DUP_FIELDNAME on
-- re-runs, so this stays idempotent without the non-portable clause.
ALTER TABLE alarm_rules ADD COLUMN debounce_json JSON;
-- debounce_json example: {"door_state": {"min_duration_s": 30, "cooldown_s": 300}}
