-- Migration v3 — robustness: device logs, dead-letter, readings rollup.
-- Fresh installs get these from schema.sql. Run once on an existing DB.
USE iothub;

CREATE TABLE IF NOT EXISTS device_logs (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  node_id   VARCHAR(64) NOT NULL,
  kind      ENUM('diag','ota') NOT NULL DEFAULT 'diag',
  level     VARCHAR(32),
  payload   TEXT,
  ts        DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (node_id, ts)
);

CREATE TABLE IF NOT EXISTS dead_letter (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  source     VARCHAR(120),
  error      VARCHAR(500),
  payload    TEXT,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

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
