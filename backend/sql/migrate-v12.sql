-- migrate-v12.sql — zero-touch device onboarding (auto-register pending nodes)
-- for EXISTING databases. schema.sql carries these for fresh installs; the ALTERs
-- backfill an existing `nodes` table. migrate.ts tolerates duplicate-column errors.
USE iothub;

-- Onboarding lifecycle. Existing rows default to 'active' (already provisioned).
-- A device that publishes telemetry with an unknown id is auto-created as
-- 'pending' (org derived from its MQTT topic) and waits for admin approval.
ALTER TABLE nodes ADD COLUMN status ENUM('pending','active','rejected') NOT NULL DEFAULT 'active';
ALTER TABLE nodes ADD COLUMN first_seen DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3);
ALTER TABLE nodes ADD INDEX idx_nodes_status (status);
