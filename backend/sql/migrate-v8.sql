-- Migration v8 — event problem catalog (root causes for acknowledge).
-- Fresh installs get this from schema.sql. Run once on an existing DB.
USE iothub;
CREATE TABLE IF NOT EXISTS event_problems (
  id            VARCHAR(64) PRIMARY KEY,
  org_id        VARCHAR(64) NOT NULL,
  department_id VARCHAR(64),
  domain        VARCHAR(32),
  label         VARCHAR(200) NOT NULL,
  created_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (org_id, department_id), INDEX (domain)
);
