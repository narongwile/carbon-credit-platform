-- migrate-v11.sql — forgot-password + employee directory + org geo fallback
-- (for EXISTING databases; schema.sql already contains these for fresh installs).
-- Plain ALTERs (portable MySQL 8.x); migrate.ts records each file once and
-- tolerates duplicate-column errors, so this stays idempotent.
USE iothub;

-- 1) Password reset tokens (forgot-password flow). token holds a signed JWT, so
--    it needs room beyond 128 chars → VARCHAR(255).
CREATE TABLE IF NOT EXISTS password_resets (
  token      VARCHAR(255) PRIMARY KEY,
  user_id    VARCHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used       TINYINT(1) DEFAULT 0,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (user_id)
);
-- Widen the token column if the table pre-existed with VARCHAR(128).
ALTER TABLE password_resets MODIFY token VARCHAR(255);

-- 2) Employee directory (CSV allowlist → auto-assign a matched registrant as
--    a viewer on their org/department at signup time).
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

-- 3) Org factory geo fallback — ETERNITY transformer sensors have no GPS, so the
--    admin pins the factory location once and all its nodes plot there.
ALTER TABLE organizations ADD COLUMN lat DECIMAL(10,7);
ALTER TABLE organizations ADD COLUMN lng DECIMAL(10,7);
