-- migrate-v51.sql — Detect two physical devices publishing under one node id
--
-- MQTT gives a subscriber no way to tell WHICH client published a frame: the
-- PUBLISH packet carries no client identity, so worker/main.go cannot see a
-- clientid at all (paho's Message interface is Topic/Payload/Qos/Retained —
-- nothing else). Identity comes only from the payload's own nodeId, which two
-- boards flashed from the same firmware image will happily both claim.
--
-- The broker enforces clientid uniqueness at the connection layer, so two such
-- boards kick each other in a reconnect loop — but the application never learns
-- that happened, and their readings interleave into ONE node's history:
-- charts, alarms and the health index then describe two different transformers
-- averaged together, with nothing in the logs to say so.
--
-- `uptime` is the signal that survives all of this. It arrives on every
-- heartbeat, counts seconds since THAT board booted, and for a single device
-- can only ever climb. Two devices alternating under one id make it jump
-- backwards on roughly every other frame. A device that merely rebooted makes
-- it jump backwards exactly once, which is why the count (not a single event)
-- is what gets flagged — see uptimeRegressionThreshold in worker/main.go.
USE iothub;

ALTER TABLE device_presence
  -- Last uptime reported for this node, in seconds since the device booted.
  -- NULL until the first heartbeat carrying one arrives; firmware that never
  -- sends uptime simply never participates in this check.
  ADD COLUMN last_uptime BIGINT UNSIGNED NULL AFTER fw,
  -- Backwards jumps counted inside the current window. Reset when the window
  -- expires, so an isolated reboot every few weeks never accumulates.
  ADD COLUMN uptime_regressions SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER last_uptime,
  ADD COLUMN uptime_window_start DATETIME(3) NULL AFTER uptime_regressions,
  -- Set when the count crosses the threshold; cleared by an admin from the
  -- pending/device screen once the cause is resolved. Deliberately a timestamp
  -- rather than a boolean so "when did this start" survives.
  ADD COLUMN identity_conflict_at DATETIME(3) NULL AFTER uptime_window_start;

-- The admin screens filter on it, and on a large fleet the flagged rows are a
-- tiny minority — so this reads a handful of rows instead of the whole table.
CREATE INDEX idx_presence_identity_conflict ON device_presence (identity_conflict_at);
