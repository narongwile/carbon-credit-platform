-- migrate-v55.sql — multi-device scope and multi-day sequence scheduling
--
-- Widens scope_id so a schedule can target multiple device IDs (comma-separated),
-- and widens day_of_week and day_of_month to support multiple firing days (e.g. '1,4' for Mon+Thu).

USE iothub;

ALTER TABLE report_schedules MODIFY COLUMN scope_id VARCHAR(1000) NULL;
ALTER TABLE report_schedules MODIFY COLUMN day_of_week VARCHAR(32) NULL;
ALTER TABLE report_schedules MODIFY COLUMN day_of_month VARCHAR(128) NULL;
