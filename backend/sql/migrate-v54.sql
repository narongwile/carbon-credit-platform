-- migrate-v54.sql — notification channels per user
--
-- notification_channels supports org-wide (department_id IS NULL AND user_id IS NULL),
-- per-department (department_id IS NOT NULL), and per-user (user_id IS NOT NULL).

USE iothub;

-- MySQL does NOT support IF NOT EXISTS on ADD COLUMN or CREATE INDEX — that is
-- MariaDB-only syntax, and it is a hard parse error here, not a no-op. This
-- file shipped with it and every migration run died on statement 1, so v54
-- AND everything after it (v55, v56, v57) never applied to any database.
--
-- Idempotency is already handled by the runner: backend/src/migrate.ts treats
-- ER_DUP_FIELDNAME and ER_DUP_KEYNAME as "expected on re-run" and continues.
-- So the plain statements are the correct form — safe to re-run, and portable.
ALTER TABLE notification_channels ADD COLUMN user_id VARCHAR(64) NULL AFTER department_id;
CREATE INDEX idx_nc_user ON notification_channels (org_id, user_id);
