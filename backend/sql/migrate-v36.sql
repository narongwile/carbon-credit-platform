-- migrate-v36.sql — many photos per device, each with a job to do.
--
-- node_images (v27) is keyed `node_id PRIMARY KEY`: exactly one photo per
-- device, forever. A real transformer needs several, and they are not
-- alternatives to each other — each answers a different question:
--   overview    what am I walking up to
--   nameplate   what is it rated for (the close-up nobody can read at
--               dashboard size, which is why the lightbox exists)
--   tapchanger  the part that gets operated and inspected on its own cycle
--   thermal     an IR scan, only meaningful next to the visible-light shot
--   condition   as-found / after-repair, i.e. a record over TIME rather than
--               a single current state
--
-- Hence one row per photo with a kind and an explicit order, rather than a
-- handful of extra BLOB columns on the old table: the set is open-ended (an
-- inspection produces however many condition shots it produces) and ordering
-- is something an admin decides, not something the schema should fix.
--
-- thumb_data is stored, not derived on read. Every list surface (Fleet, Device
-- Management, the map popup, Pending Devices) wants a small image for many
-- devices at once; serving the full LONGBLOB for each would be tens of MB per
-- page. The browser produces both sizes at upload time — see
-- src/lib/imagePipeline.ts — so the server never decodes an image.
--
-- taken_at / lat / lng come from the photo's own EXIF when it has any. A
-- transformer photographed on site carries the coordinate the device should
-- have, and taken_at is the date that matters for a condition record — not
-- updated_at, which is merely when someone got round to uploading it.
--
-- annotations is a JSON array of normalised (0..1) markers drawn on the image,
-- so an arrow pointing at a hotspot stays on that hotspot at any render size.
--
-- Rows carry no org_id: the node already belongs to exactly one org and this
-- table lives in the same ORG database as `nodes`, exactly like node_images
-- and node_nameplates before it.
USE iothub;

CREATE TABLE IF NOT EXISTS node_photos (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  node_id      VARCHAR(64) NOT NULL,
  kind         VARCHAR(24) NOT NULL DEFAULT 'overview',
  -- Display order within the device. The lowest position is the cover — what
  -- the dashboard, the tables and the map popup show.
  position     INT NOT NULL DEFAULT 0,
  image_data   LONGBLOB,
  -- ~320px JPEG. Nullable so photos carried over from node_images below, which
  -- never had one, still work: the read path falls back to the full image and
  -- the thumbnail appears the next time that photo is replaced.
  thumb_data   BLOB,
  content_type VARCHAR(100),
  width        SMALLINT UNSIGNED,
  height       SMALLINT UNSIGNED,
  bytes        INT UNSIGNED,
  caption      VARCHAR(255),
  taken_at     DATETIME(3) NULL,
  lat          DECIMAL(10,7) NULL,
  lng          DECIMAL(10,7) NULL,
  annotations  JSON NULL,
  updated_by   VARCHAR(120),
  updated_at   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_node_photos_node (node_id, position),
  INDEX idx_node_photos_kind (node_id, kind)
);

-- Carry every existing photo over as the device's overview shot, so nothing
-- an admin already uploaded disappears the moment this deploys. INSERT ...
-- SELECT with a NOT EXISTS guard keeps the file safe to re-run.
INSERT INTO node_photos (node_id, kind, position, image_data, content_type, caption, updated_by, updated_at)
SELECT i.node_id, 'overview', 0, i.image_data, i.content_type, i.caption, i.updated_by, i.updated_at
  FROM node_images i
 WHERE i.image_data IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM node_photos p WHERE p.node_id = i.node_id);

-- node_images is deliberately NOT dropped. It is the rollback path for this
-- migration, and it costs nothing to keep: the read/write paths all move to
-- node_photos, so it simply stops changing.
