-- migrate-v45.sql — a real, persisted Grafana URL per device
--
-- The Free-Style dashboard (FreestyleDashboard.tsx, device.theme='freestyle')
-- rendered fabricated charts and an "Open in Grafana" button that pointed at
-- an "Embed URL" text box holding purely local React state — nothing saved
-- it, so it reset to blank on every page load and the link went nowhere for
-- every real device. There was no admin-facing way to set a device's actual
-- Grafana dashboard URL at all.
--
-- grafana_url is additive and nullable: unset means "no Grafana dashboard
-- configured for this device yet", which the frontend now renders as an
-- explicit empty state instead of silently falling back to mock charts.
USE iothub;

ALTER TABLE nodes ADD COLUMN grafana_url VARCHAR(500) NULL;
