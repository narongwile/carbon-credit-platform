-- Migration v18 — Catch-up missing schema changes
-- These were added to schema.sql/bloodbox.sql but missing from prior migrations.
USE iothub;

-- 1. Add phone column to users (was missing from all previous migrations)
ALTER TABLE users ADD COLUMN phone VARCHAR(40);

-- 2. Create blood_box_journey_events (was in bloodbox.sql but not in any migrate-vX)
CREATE TABLE IF NOT EXISTS blood_box_journey_events (
  id VARCHAR(64) PRIMARY KEY,
  transit_id VARCHAR(64) NOT NULL,
  floor_id VARCHAR(64),
  event_type VARCHAR(64),
  label VARCHAR(120),
  `signal` VARCHAR(32),
  lat FLOAT,
  lng FLOAT,
  pos_x_m FLOAT,
  pos_y_m FLOAT,
  temp_c FLOAT,
  battery_pct FLOAT,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);
