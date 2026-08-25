-- migrate-v53.sql — personal (per-user, per-node) alarm thresholds
--
-- alarm_rules is one row per node — the single shared threshold everyone
-- (admin and every viewer) sees as that device's WARNING/CRITICAL state.
-- There was no way for an individual viewer to say "notify ME specifically
-- when THIS reading crosses a threshold I pick" without changing what
-- everyone else sees for that node.
--
-- Deliberately its own table, not folded into user_prefs.prefs (where
-- alertChannels/alertTopics already live per-node, per-user): the ingest
-- worker needs "every personal rule for node X" on every telemetry tick,
-- which a JSON blob can't answer without scanning and parsing every org
-- user's whole prefs column. mePutFunc/MyAlertSettings' save() also already
-- do a whole-blob read-then-replace for alertChannels/alertTopics — a
-- personal-rule editor sharing that same blob on its own save timing would
-- race against those toggles. A dedicated row makes both problems moot.
USE iothub;

CREATE TABLE IF NOT EXISTS user_node_rules (
  user_id     VARCHAR(64) NOT NULL,
  node_id     VARCHAR(64) NOT NULL,
  org_id      VARCHAR(64) NOT NULL,
  domain      VARCHAR(32) NOT NULL,
  rule_json   JSON NOT NULL,
  updated_at  DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, node_id),
  INDEX idx_user_node_rules_node (node_id)
);
