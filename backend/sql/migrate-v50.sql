-- migrate-v50.sql — Surface firmware-raised (edge) alarms to operators
--
-- Firmware evaluates some conditions itself and publishes them on
-- P/alarm/{sid} with {edge:true, severity, sid, value} — the Alarm List's
-- "External Fault/Event" (animals, lightning, a grid incident) is exactly this
-- shape: an event the device reports, not a threshold the cloud computes from
-- a reading.
--
-- Those alarms were persisted to edge_alarm_log and went no further. Nothing
-- reads that table: no API endpoint selects from it, no page renders it, and
-- the flow node that writes it has no downstream wire. So a fault the device
-- detected and reported never reached the alarm list, never notified anyone
-- and never escalated.
--
-- Edge alarms now also land in alarm_events, where the alarm UI, the notifier
-- and the escalation scan already look. `source` keeps the provenance that
-- alarm_events could not previously express — the frontend's AlarmEvent type
-- has carried a 'edge' | 'cloud' field all along with no column behind it.
USE iothub;

ALTER TABLE alarm_events
  ADD COLUMN source ENUM('edge','cloud') NOT NULL DEFAULT 'cloud' AFTER kind;

-- Existing rows were all cloud-evaluated; the DEFAULT already covers them, and
-- naming it explicitly keeps a re-run of this migration honest.
UPDATE alarm_events SET source = 'cloud' WHERE source IS NULL;

CREATE INDEX idx_alarm_events_source ON alarm_events (source);
