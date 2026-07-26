-- migrate-v13.sql — dedicated floor-plan image storage (for EXISTING databases).
-- schema.sql carries this for fresh installs; migrate.ts records the file once.
USE iothub;

-- Floor-plan layout images: bytes (LONGBLOB) + a served path (image_url), keyed by
-- org + floor. Previously the whole floorplan blob (incl. images) was crammed into
-- user_prefs.prefs (TEXT, 64 KB) as an ephemeral blob: URL — which never persisted.
CREATE TABLE IF NOT EXISTS floorplans (
  org_id       VARCHAR(64) NOT NULL,
  floor_id     VARCHAR(64) NOT NULL,
  image_url    VARCHAR(512),
  image_data   LONGBLOB,
  content_type VARCHAR(100),
  updated_at   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (org_id, floor_id)
);
