-- migrate-v56.sql — add product domain filter to report_schedules
--
-- Allows scheduled reports to filter by product domain (e.g. transformer, automobile, coldchain)
-- so multi-product tenants can deliver dedicated domain audits independently.

USE iothub;

-- MySQL has no IF NOT EXISTS on ADD COLUMN (MariaDB-only). The runner already
-- tolerates ER_DUP_FIELDNAME on re-run — see migrate-v54.sql's note.
ALTER TABLE report_schedules ADD COLUMN domain VARCHAR(32) NULL DEFAULT 'all';
