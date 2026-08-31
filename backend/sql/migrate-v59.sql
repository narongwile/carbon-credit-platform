USE iothub;

-- Personal alarm events — the history behind "My Personal Alarm Thresholds".
--
-- WHY A SEPARATE TABLE
-- --------------------
-- 42c9e19a logged these into the shared alarm_events table, tagging them by
-- writing 'PERSONAL:<userId>' into the `source` column. That column is
--
--     source ENUM('edge','cloud') NOT NULL DEFAULT 'cloud'
--
-- so the value does not fit. Because the statement was INSERT IGNORE, MySQL
-- downgraded the truncation error to a warning and stored the ENUM's empty
-- error member instead. Two consequences, both bad:
--
--   1. The console that reads them back filters on
--      `source === 'PERSONAL:' + userId`, which can never match '' — so the
--      personal history was permanently empty. The feature could not work.
--
--   2. Far worse, the row still landed in alarm_events indistinguishable from
--      a real org alarm. A private threshold — the whole point of which is
--      that it "does not change the device's official alarm state that others
--      see" — therefore showed up in /admin/alarms for the entire
--      organization, in the sidebar badge, in the open-alarm counts and in
--      exported reports. And since it carried severity + acknowledged_at NULL
--      + cleared_at NULL, escalationFunc picked it up and re-alerted one
--      user's private early-warning threshold to the whole department after
--      ESCALATE_AFTER_MIN.
--
-- Keeping personal events in their own table makes "never visible to anyone
-- else" true by construction rather than dependent on every present and
-- future org-wide query remembering to exclude them — the same reasoning that
-- put personal RULES in user_node_rules instead of the user_prefs blob.
CREATE TABLE IF NOT EXISTS personal_alarm_events (
  id              VARCHAR(160) PRIMARY KEY,
  user_id         VARCHAR(64) NOT NULL,
  node_id         VARCHAR(64) NOT NULL,
  org_id          VARCHAR(64) NOT NULL,
  param_key       VARCHAR(40) NOT NULL,
  param_label     VARCHAR(80) NOT NULL,
  severity        ENUM('WARNING','CRITICAL') NOT NULL,
  kind            ENUM('threshold','rate','offline') NOT NULL DEFAULT 'threshold',
  value           DECIMAL(12,3) NOT NULL,
  threshold       DECIMAL(12,3) NOT NULL,
  unit            VARCHAR(16),
  raised_at       DATETIME(3) NOT NULL,
  acknowledged_at DATETIME(3) NULL,
  acknowledged_by VARCHAR(120) NULL,
  -- The console's own query: "my events on this device, newest first".
  INDEX idx_pae_user_node (user_id, node_id, raised_at),
  INDEX idx_pae_raised (raised_at)
);

-- Clean up rows the broken INSERT already wrote. They are identifiable
-- without ambiguity: the id prefix is unique to that code path, and no
-- legitimate alarm_events row is ever written with an empty source (the
-- column is NOT NULL DEFAULT 'cloud' and the engine sets 'edge' or 'cloud').
-- Left behind they would keep inflating every org's alarm console and keep
-- escalating strangers' private thresholds.
DELETE FROM alarm_events WHERE id LIKE 'pevt\_%' AND source = '';
