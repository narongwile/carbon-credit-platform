-- Migration v5 — users + per-user config (configProfile).
-- Fresh installs get these from schema.sql. Run once on an existing DB.
USE iothub;

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(64) PRIMARY KEY,
  org_id        VARCHAR(64) NOT NULL,
  email         VARCHAR(160),
  name          VARCHAR(120),
  role          VARCHAR(32),
  department_id VARCHAR(64),
  created_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (org_id)
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id    VARCHAR(64) PRIMARY KEY,
  prefs      TEXT,
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);
