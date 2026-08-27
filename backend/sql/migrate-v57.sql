-- migrate-v57.sql — widen report_schedules.channel to support LINE & Webhook
--
-- Widens channel from ENUM('email','telegram') to VARCHAR(32) so schedules can
-- target LINE Official Account (Flex Message) and Cloud Webhooks (SAP / S3 / ERP).

USE iothub;

ALTER TABLE report_schedules MODIFY COLUMN channel VARCHAR(32) NOT NULL DEFAULT 'email';
