-- Migration v4 — live-map geo + scheduled reports.
-- Fresh installs get these from schema.sql. Run once on an existing DB.
USE iothub;

ALTER TABLE nodes ADD COLUMN lat DECIMAL(10,7);
ALTER TABLE nodes ADD COLUMN lng DECIMAL(10,7);

CREATE TABLE IF NOT EXISTS report_schedules (
  id           VARCHAR(64) PRIMARY KEY,
  org_id       VARCHAR(64) NOT NULL,
  name         VARCHAR(160) NOT NULL,
  scope        ENUM('device','department','org') NOT NULL DEFAULT 'device',
  scope_id     VARCHAR(64),
  sequence     ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'daily',
  format       ENUM('PDF','XLSX','CSV') NOT NULL DEFAULT 'CSV',
  recipients   VARCHAR(500),
  enabled      TINYINT(1) DEFAULT 1,
  last_run_at  DATETIME(3) NULL,
  next_run_at  DATETIME(3) NULL,
  INDEX (org_id), INDEX (enabled, next_run_at)
);
