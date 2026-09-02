USE iothub;

-- migrate-v60.sql — 21 CFR Part 11 / ISA-84 Enterprise Security Audit Trail & Four-Eyes Dual Control
--
-- Provides an append-only, tamper-evident audit ledger and two-man rule (maker-checker)
-- authorization workflow for critical operational changes (setpoint adjustments, alarm shelving,
-- firmware OTA deployments, SOP modifications, and emergency overrides).

CREATE TABLE IF NOT EXISTS audit_trail_logs (
  id                 VARCHAR(64) PRIMARY KEY,
  org_id             VARCHAR(64) NOT NULL,
  actor_id           VARCHAR(64) NOT NULL,
  actor_name         VARCHAR(160) NOT NULL,
  actor_email        VARCHAR(160) NOT NULL,
  actor_role         VARCHAR(64) NOT NULL,
  ip_address         VARCHAR(45) NOT NULL,
  action             VARCHAR(64) NOT NULL,
  target_asset_id    VARCHAR(64) NOT NULL,
  target_asset_name  VARCHAR(160) NOT NULL,
  before_val         TEXT NOT NULL,
  after_val          TEXT NOT NULL,
  justification      TEXT NOT NULL,
  work_order_id      VARCHAR(64) NULL,
  checksum           VARCHAR(64) NOT NULL,
  approval_status    ENUM('APPROVED','REJECTED','PENDING_APPROVAL') NOT NULL DEFAULT 'APPROVED',
  checker_id         VARCHAR(64) NULL,
  checker_name       VARCHAR(160) NULL,
  checker_email      VARCHAR(160) NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_atl_org_created (org_id, created_at),
  INDEX idx_atl_org_action (org_id, action),
  INDEX idx_atl_target (org_id, target_asset_id)
);

CREATE TABLE IF NOT EXISTS audit_pending_approvals (
  id                 VARCHAR(64) PRIMARY KEY,
  org_id             VARCHAR(64) NOT NULL,
  maker_id           VARCHAR(64) NOT NULL,
  maker_name         VARCHAR(160) NOT NULL,
  maker_email        VARCHAR(160) NOT NULL,
  maker_role         VARCHAR(64) NOT NULL,
  action             VARCHAR(64) NOT NULL,
  target_asset_id    VARCHAR(64) NOT NULL,
  target_asset_name  VARCHAR(160) NOT NULL,
  description        VARCHAR(255) NOT NULL,
  before_val         TEXT NOT NULL,
  after_val          TEXT NOT NULL,
  justification      TEXT NOT NULL,
  work_order_id      VARCHAR(64) NULL,
  status             ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  checker_id         VARCHAR(64) NULL,
  checker_name       VARCHAR(160) NULL,
  checker_email      VARCHAR(160) NULL,
  checked_at         DATETIME(3) NULL,
  reject_reason      TEXT NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_apa_org_status (org_id, status, created_at)
);
