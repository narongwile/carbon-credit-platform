-- migrate-v15.sql — maintenance-report downloads + report delivery channels
-- (for EXISTING databases). schema.sql carries these for fresh installs; the
-- runner tolerates ER_DUP_FIELDNAME so re-runs are safe.
USE iothub;

-- Store a document's MIME type so downloads open correctly (PDF, image, …).
ALTER TABLE documents ADD COLUMN content_type VARCHAR(100);

-- Scheduled reports can deliver by email or Telegram; recipients holds the
-- email(s) for email, or the Telegram chat id for telegram.
ALTER TABLE report_schedules ADD COLUMN channel ENUM('email','telegram') NOT NULL DEFAULT 'email';
