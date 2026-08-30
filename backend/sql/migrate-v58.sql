-- migrate-v58.sql — widen notification_channels.channel to support webhook
--
-- Widens channel from ENUM('email','line','telegram','googlechat') to VARCHAR(32) so
-- organization-wide and per-user fallback channels can target webhooks without truncation.

USE iothub;

ALTER TABLE notification_channels MODIFY COLUMN channel VARCHAR(32) NOT NULL;

