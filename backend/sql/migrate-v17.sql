-- migrate-v17.sql — global platform settings (superadmin-managed SMTP/sender)
-- (for EXISTING databases). schema.sql carries this for fresh installs; the
-- runner tolerates ER_TABLE_EXISTS_ERROR so re-runs are safe. The backend also
-- self-heals this table on first write, so migration ordering is not critical.
USE iothub;

-- Key-value; the SMTP password (smtp.pass) is stored AES-GCM encrypted by the app.
CREATE TABLE IF NOT EXISTS platform_settings (
  skey       VARCHAR(64) PRIMARY KEY,
  sval       TEXT,
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);
