-- Migration v2 — run ONCE on an existing DB created before:
--   • alarm auto-clear / offline events  (alarm_events.cleared_at, kind 'offline')
--   • device downlink                    (nodes.mqtt_prefix)
-- Fresh installs already get these from schema.sql. MySQL lacks ADD COLUMN
-- IF NOT EXISTS, so run each line once (errors on re-run are harmless).
USE iothub;

ALTER TABLE alarm_events MODIFY COLUMN kind ENUM('threshold','rate','offline') NOT NULL;
ALTER TABLE alarm_events ADD COLUMN cleared_at DATETIME(3) NULL;
ALTER TABLE alarm_events ADD INDEX (cleared_at);
ALTER TABLE nodes ADD COLUMN mqtt_prefix VARCHAR(255);
