-- Migration v6 — tenancy / RBAC data model (provisioning).
-- Fresh installs get these from schema.sql. Run once on an existing DB.
USE iothub;

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

CREATE TABLE IF NOT EXISTS org_entitlements (
  org_id   VARCHAR(64) NOT NULL,
  platform VARCHAR(40) NOT NULL,
  PRIMARY KEY (org_id, platform)
);

CREATE TABLE IF NOT EXISTS product_access (
  scope    ENUM('department','user') NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  domain   VARCHAR(32) NOT NULL,
  level    ENUM('none','view','manage') NOT NULL DEFAULT 'view',
  PRIMARY KEY (scope, scope_id, domain)
);
