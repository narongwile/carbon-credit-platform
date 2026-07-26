-- migrate-v14.sql — zero-touch onboarding hardening (for EXISTING databases).
-- schema.sql carries these for fresh installs; migrate.ts records the file once.
-- The runner tolerates ER_DUP_FIELDNAME / ER_DUP_ENTRY so re-runs are safe.
USE iothub;

-- Store the latest telemetry sample for a device so the pending-approval screen
-- can show an admin the actual readings before they approve the device.
ALTER TABLE device_presence ADD COLUMN last_sample JSON;

-- Claimable pool for devices whose MQTT topic org does not match a real org.
-- The worker auto-registers such orphans here; only a superadmin sees and
-- reassigns them. Suspended so it can never behave like a real tenant.
INSERT IGNORE INTO organizations (id, name, status) VALUES ('__unassigned__', 'Unassigned / Pending Claim', 'suspended');
