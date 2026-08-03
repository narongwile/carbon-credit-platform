-- migrate-v26.sql — which parameters a product's devices actually display
--
-- SENSOR READINGS was never configurable. Every display path read the hardcoded
-- ALARM_SCHEMA list in the frontend: the node page showed each schema param the
-- device reported plus any unrecognised key, and the transformer page showed six
-- fixed slots and nothing else. AlarmParamConfig looks like the place to change
-- this but only edits warn/critical thresholds.
--
-- That was tolerable while a transformer sent six values. A two-topic asset
-- (electrical meter + box sensor merged onto one node) reports around forty, and
-- an operator watching for oil temperature should not have to find it among
-- THD_VoltCA and ApparentpowerB.
--
-- Scoped to org+domain, with an optional per-node override — the same shape the
-- alarm rules already use (org_domain_rules seeds alarm_rules), so an admin
-- configures a product once rather than device by device.
--
-- No rows for a scope means "not configured" and everything is shown. An empty
-- selection cannot be expressed, deliberately: a device page showing nothing is
-- never what someone meant, and a fail-closed reading would blank every existing
-- dashboard the moment this deploys.
USE iothub;

CREATE TABLE IF NOT EXISTS display_params (
  org_id    VARCHAR(64) NOT NULL,
  domain    VARCHAR(32) NOT NULL,
  -- NULL = the default for every device of this product in the org.
  node_id   VARCHAR(64) NULL,
  param_key VARCHAR(64) NOT NULL,
  -- Display order; ties fall back to the order the device reports them in.
  position  INT NOT NULL DEFAULT 0,
  INDEX idx_display_params_scope (org_id, domain, node_id)
);

-- A node-level override and an org default can hold the same key, so the unique
-- key has to include node_id. MySQL treats NULLs as distinct in a UNIQUE index,
-- which is exactly wrong for "one row per org default" — so the org default is
-- keyed on a sentinel instead of NULL.
ALTER TABLE display_params ADD COLUMN node_scope VARCHAR(64)
  AS (IFNULL(node_id, '*')) STORED;
ALTER TABLE display_params
  ADD UNIQUE KEY uq_display_params (org_id, domain, node_scope, param_key);
