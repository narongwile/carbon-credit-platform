-- migrate-v16.sql — org+domain default alarm rule / telemetry param set
-- (for EXISTING databases). schema.sql carries this for fresh installs; the
-- runner tolerates ER_TABLE_EXISTS_ERROR so re-runs are safe.
USE iothub;

-- Set at provision time (before any device exists) and used to seed a node's
-- alarm_rules the moment it is approved (zero-touch) or manually provisioned.
CREATE TABLE IF NOT EXISTS org_domain_rules (
  org_id        VARCHAR(64) NOT NULL,
  domain        VARCHAR(32) NOT NULL,
  rule_json     JSON NOT NULL,
  debounce_json JSON,
  updated_by    VARCHAR(120),
  updated_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (org_id, domain)
);
