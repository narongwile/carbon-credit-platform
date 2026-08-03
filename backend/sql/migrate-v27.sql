-- migrate-v27.sql — a photo of the actual device, replacing the generic 3D twin
--
-- The node detail page renders Transformer3D: one hand-modelled unit, drawn
-- identically for every transformer in every organization. ETERNITY's customers
-- run units from pole-mounted distribution transformers to 2500 kVA oil-immersed
-- power transformers, so the model on screen matched the asset in the field
-- almost never — while looking exactly like a faithful digital twin of it. A
-- picture that is wrong is worse than no picture, because nobody doubts it.
--
-- An admin uploads the real photo (or a spec drawing / nameplate shot) and every
-- role sees the same image: a viewer diagnosing an alarm at 2am needs to
-- recognise the unit they are being sent to.
--
-- Bytes in their own table, exactly like org_logos (migrate-v24) and floorplans:
-- nodes is read by the fleet list on every page load, and a LONGBLOB column on it
-- would ship megabytes with each SELECT.
--
-- Lives in the ORG database. `nodes` does, and a photo of a device that is not in
-- the same database as the device is a row nothing can join to.
USE iothub;

CREATE TABLE IF NOT EXISTS node_images (
  node_id      VARCHAR(64) PRIMARY KEY,
  image_data   LONGBLOB,
  content_type VARCHAR(100),
  -- Shown under the photo: "2500 kVA ONAN, nameplate 2019" says more than the
  -- filename does, and the person who needs it is standing in front of the unit.
  caption      VARCHAR(255),
  updated_by   VARCHAR(120),
  updated_at   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);
