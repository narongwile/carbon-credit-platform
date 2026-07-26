-- migrate-v19.sql — split "link lost" from "device offline"
--
-- The presence sweep used one threshold, so LINK_LOST and DEVICE_OFFLINE were
-- written in the same pass and carried the same timestamp — the connectivity
-- timeline showed both at e.g. 23:10 and never told the operator that the link
-- had already been silent for half a minute before the device was declared
-- offline.
--
-- Detecting the earlier stage needs the time of the last stored READING, which
-- is not the same as last_seen: last_seen also moves on heartbeat/status frames
-- (every 30s), so a device whose sensors stopped while MQTT stayed up would
-- flap in and out of a short last_seen window. The ingest worker now stamps
-- last_reading_at only when it actually persists readings, and the sweep raises
-- LINK_LOST from that column.
USE iothub;

ALTER TABLE device_presence ADD COLUMN last_reading_at DATETIME(3) NULL AFTER last_seen;

-- The sweep scans "online devices whose readings went quiet", every tick.
ALTER TABLE device_presence ADD INDEX idx_presence_reading (online, last_reading_at);
