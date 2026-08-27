-- migrate-v54.sql — notification channels per user
--
-- notification_channels supports org-wide (department_id IS NULL AND user_id IS NULL),
-- per-department (department_id IS NOT NULL), and per-user (user_id IS NOT NULL).

USE iothub;

ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER department_id;
CREATE INDEX IF NOT EXISTS idx_nc_user ON notification_channels (org_id, user_id);
