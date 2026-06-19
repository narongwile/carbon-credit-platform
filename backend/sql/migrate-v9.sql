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
ALTER TABLE alarm_rules ADD COLUMN debounce_json JSON;
-- debounce_json example: {"door_state": {"min_duration_s": 30, "cooldown_s": 300}}
