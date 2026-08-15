-- migrate-v47.sql — admin-configurable multi-parameter trend charts
USE iothub;

-- One row per admin-created chart. A chart is just a named, ordered selection
-- of this device's own parameter keys — alarm thresholds for those parameters
-- stay in alarm_rules (matched by key), not duplicated here, so a value alarms
-- the same way whether it's viewed alone or as part of a combined chart.
CREATE TABLE IF NOT EXISTS chart_definitions (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  title VARCHAR(120) NOT NULL,
  param_keys JSON NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by VARCHAR(120),
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_chart_definitions_node (node_id)
);
