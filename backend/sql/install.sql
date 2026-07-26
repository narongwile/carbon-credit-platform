-- ONEOPS — fresh-install migration (run order for an EMPTY database).
-- Run from the sql/ directory:  cd backend/sql && mysql -h HOST -u admin -p < install.sql
-- (SOURCE resolves paths from the client's working directory.)
--
-- schema.sql + bloodbox.sql cover the v2–v8 objects (already absorbed). The
-- v9/v10 objects (readings.quality, device_presence.*, alarm_rules.debounce_json,
-- ota_releases, ota_deployments, transport_events, edge_alarm_log,
-- offline_sync_log, blood_box_transit_telemetry, …) are NOT in schema.sql, so a
-- fresh install must also source migrate-v9 + migrate-v10 to be complete. These
-- two run cleanly here because their objects don't yet exist in a fresh DB
-- (CREATE TABLE IF NOT EXISTS + plain ADD COLUMN on absent columns).

SOURCE schema.sql;        -- 1) core schema (creates db `iothub` + all core tables)
SOURCE bloodbox.sql;      -- 2) BloodBOX domain tables
SOURCE migrate-v9.sql;    -- 3) firmware reliability + OTA + offline buffer tables
SOURCE migrate-v10.sql;   -- 4) firmware v2 telemetry: reading quality + presence health/pos
SOURCE seed-nodes.sql;    -- 5) (optional) demo fleet: nodes + geo + mqtt_prefix
SOURCE seed-tenancy.sql;  -- 6) (optional) demo orgs/users/entitlements/event-problems

SELECT 'ONEOPS schema installed' AS status;
