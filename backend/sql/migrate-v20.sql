-- migrate-v20.sql — one physical asset published across several MQTT topics
--
-- An ETERNITY transformer can be wired as two feeds: the power meter publishes
-- the electrical set (VoltAB, CurrentA, ActivepowerTotal, THD_*, kWh, …) on one
-- topic, and the box sensor publishes the environmental/DGA set (Oiltemp, H2,
-- OilMoisture, Tbox, RHbox, Tamb, RHamb) on another. Each topic carries its own
-- nodeId, so zero-touch onboarding registered them as two unrelated devices:
-- the fleet listed one transformer twice, and — worse — the alarm rules that
-- matter most for a transformer (oil temperature, dissolved hydrogen, moisture)
-- sat on a node that had no electrical context and could never be reached from
-- the transformer the operator actually opens.
--
-- merge_into names the node this feed belongs to. The ingest worker stores the
-- readings under that node instead of the publishing one, so both topics land
-- on a single device for readings, alarms, trends and reports; the secondary
-- row is kept (it records which topic the data arrived on, and clearing the
-- column splits the feeds apart again) but is hidden from the fleet.
--
-- NULL = an ordinary standalone device, which is every existing row.
USE iothub;

ALTER TABLE nodes ADD COLUMN merge_into VARCHAR(64) NULL AFTER status;

-- The fleet query filters on "not a secondary feed" on every listing, and the
-- worker resolves a publishing node to its primary on every telemetry frame.
ALTER TABLE nodes ADD INDEX idx_nodes_merge_into (merge_into);
