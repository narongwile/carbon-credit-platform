-- migrate-v10.sql — firmware v2.0 telemetry: reading quality + live health/position
--
-- Closes the gaps between what the ESP32 v2 firmware now emits and the schema.
-- Plain ALTERs (portable MySQL/MariaDB); migrate.ts records each file once and
-- tolerates duplicate-column / duplicate-key errors on re-run.
--
-- NOTE: adding the columns is only half the job — the Node-RED `normalize`/ingest
-- flow (and the heartbeat handler) must be updated to WRITE these new columns,
-- otherwise they stay at their defaults. See firmware/esp32 payloads.
USE iothub;

-- 1) Reading data quality (spec §16) — distinguish a real value from a dead
--    sensor. Firmware sends quality = good | sim | error  (sim = demo fallback);
--    'stale' is reserved for cloud-side aging. Without this a "0 C" reading and
--    a broken probe are indistinguishable.
ALTER TABLE readings        ADD COLUMN quality ENUM('good','sim','error','stale') NOT NULL DEFAULT 'good' AFTER value;
ALTER TABLE readings_rollup ADD COLUMN bad_n   INT DEFAULT 0 AFTER n;   -- count of non-good samples in the bucket

-- 2) Live device health + position carried by the heartbeat (presence dashboard).
--    Heartbeat now sends: uptime, heap, time_src, transport, and for bloodbox
--    transit (FSM state) + lat/lng (live GPS).
ALTER TABLE device_presence ADD COLUMN uptime_s  INT           AFTER fw;
ALTER TABLE device_presence ADD COLUMN heap      INT           AFTER uptime_s;
ALTER TABLE device_presence ADD COLUMN time_src  VARCHAR(12)   AFTER heap;       -- ntp|lorawan|rtc|uptime
ALTER TABLE device_presence ADD COLUMN transport VARCHAR(8)    AFTER time_src;   -- wifi|4g|lora|none
ALTER TABLE device_presence ADD COLUMN transit   VARCHAR(16)   AFTER transport;  -- bloodbox: idle|in_transit|arrived|stored
ALTER TABLE device_presence ADD COLUMN lat       DECIMAL(10,7) AFTER transit;    -- bloodbox live GPS
ALTER TABLE device_presence ADD COLUMN lng       DECIMAL(10,7) AFTER lat;

-- 3) Index diag-log codes for fast fault queries (HW_SD_FAIL, LINK_OFFLINE, …).
--    diag/log payload already lands in device_logs.payload; pull the code out so
--    it is queryable/indexable.
ALTER TABLE device_logs ADD COLUMN code VARCHAR(40) AFTER level;
ALTER TABLE device_logs ADD INDEX idx_logs_code (code, ts);

-- 4) Transport enums accept both '4g' and 'lte' — firmware/UI may report either,
--    so heartbeat/failover inserts never truncate.
ALTER TABLE transport_events            MODIFY from_transport ENUM('wifi','4g','lte','lora','none') NOT NULL;
ALTER TABLE transport_events            MODIFY to_transport   ENUM('wifi','4g','lte','lora','none') NOT NULL;
ALTER TABLE blood_box_transit_telemetry MODIFY transport      ENUM('wifi','4g','lte','lora') DEFAULT 'wifi';

-- 5) Mark whether an alarm row came from the firmware edge fast-path or the
--    cloud engine, and add the transit_state to the high-freq transit telemetry.
ALTER TABLE edge_alarm_log             ADD COLUMN source        ENUM('edge','cloud') NOT NULL DEFAULT 'edge' AFTER severity;
ALTER TABLE blood_box_transit_telemetry ADD COLUMN transit_state VARCHAR(16) AFTER transport;  -- idle|in_transit|arrived|stored
