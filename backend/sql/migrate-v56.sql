-- migrate-v56.sql — add product domain filter to report_schedules
--
-- Allows scheduled reports to filter by product domain (e.g. transformer, automobile, coldchain)
-- so multi-product tenants can deliver dedicated domain audits independently.

USE iothub;

ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS domain VARCHAR(32) NULL DEFAULT 'all';
