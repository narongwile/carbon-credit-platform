-- migrate-v34.sql — admin-editable display names for MQTT parameters.
--
-- A device names its own parameters, and the wire key is whatever its firmware
-- was written to send. ALARM_SCHEMA maps the handful this platform knows
-- ('oilTemp' -> "Oil Temperature"); everything else — and a merged two-topic
-- transformer reports around forty — renders as the raw key: RHamb, Tbox,
-- OilMoisture, THD_VoltCA. Those are meaningful to whoever flashed the
-- firmware and to nobody standing in front of the unit at 2am.
--
-- An admin can now rename any of them for display. The wire key is untouched
-- and stays the join key everywhere (readings, alarm_events, display_params,
-- the rule engine) — this table only decides what a human sees.
--
-- Scope: org + domain, with an optional per-node override, exactly like
-- display_params (v26). Deliberately NOT department-scoped, unlike
-- display_params (v28): WHICH parameters a team cares about genuinely differs
-- between Maintenance and Operations, but what a sensor is CALLED does not —
-- it describes the sensor, not the audience. Adding a fourth scope dimension
-- would multiply exactly the scope-confusion this feature is meant to reduce.
--
-- An absent row means "no custom name", which falls back to the ALARM_SCHEMA
-- label and then to the raw key — the same fail-open shape as display_params,
-- so a device never renders a blank parameter name.
USE iothub;

CREATE TABLE IF NOT EXISTS param_labels (
  org_id     VARCHAR(64) NOT NULL,
  domain     VARCHAR(32) NOT NULL,
  -- NULL = the default name for every device of this product in the org.
  node_id    VARCHAR(64) NULL,
  param_key  VARCHAR(64) NOT NULL,
  label      VARCHAR(120) NOT NULL,
  updated_by VARCHAR(120),
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- MySQL treats NULLs as distinct in a UNIQUE index, which is exactly wrong
  -- for "one row per org-wide default" — so the org default is keyed on a
  -- sentinel instead of NULL. Same trick, same reason, as display_params.
  node_scope VARCHAR(64) AS (IFNULL(node_id, '*')) STORED,
  UNIQUE KEY uq_param_labels (org_id, domain, node_scope, param_key),
  INDEX idx_param_labels_scope (org_id, domain, node_scope)
);
