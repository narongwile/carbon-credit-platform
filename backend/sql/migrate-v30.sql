-- migrate-v30.sql — an audit trail for the actions taken during maintenance
--
-- The superadmin screens show a "Recent Changes" feed built from a hardcoded
-- array in mockData.ts: the same four rows, with invented timestamps, on every
-- deployment. It is the one thing on those pages that must never be fiction —
-- during an incident it is the record of who suspended whom, who moved a
-- license, and when. Suspending a customer's organization is a 403 for every
-- one of their users; that has to leave a trace with a name on it.
--
-- Deliberately generic (actor / action / target), not one column per event
-- type: the point is that adding a new administrative action must not require a
-- migration, or it will simply go unrecorded.
--
-- Control database only. Auditing is a platform-level concern and the actors are
-- superadmins, who have no tenant database of their own.
USE iothub;

CREATE TABLE IF NOT EXISTS admin_audit (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  -- Who. Denormalised on purpose: a deleted user must not erase the record of
  -- what they did, so this never joins to users.
  actor_id   VARCHAR(64),
  actor_name VARCHAR(160),
  -- What, as a stable machine-readable verb ('org.suspend', 'license.grant').
  action     VARCHAR(64) NOT NULL,
  -- Which organization the action was ABOUT (not the actor's own org).
  org_id     VARCHAR(64),
  -- Free-text subject line for the UI: an org name, a platform id, a theme set.
  target     VARCHAR(255),
  -- Optional JSON for the before/after of the change.
  detail     TEXT,
  at         DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  -- The feed is always "most recent first", usually filtered to one org.
  INDEX idx_admin_audit_at (at),
  INDEX idx_admin_audit_org (org_id, at)
);
