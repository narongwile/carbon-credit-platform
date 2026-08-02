-- migrate-v21.sql — sites as real data, so floor plans can hang off them
--
-- nodes.site_id has always existed, but there was nothing to point it at: the
-- site list lived in the frontend's seed file, so every organization saw the
-- same four hardcoded sites and a customer's real ones could not be entered at
-- all. Floor plans had the same problem one level down — the floors were a
-- hardcoded "Building A · Floor 1/2/B1" const shared by every tenant.
--
-- A site is the physical place a customer operates (a substation, a plant, a
-- hospital wing). Floor plans are reached THROUGH it, and its lat/lng is the
-- fallback pin for devices that have no GPS of their own.
USE iothub;

CREATE TABLE IF NOT EXISTS sites (
  id         VARCHAR(64) PRIMARY KEY,
  org_id     VARCHAR(64) NOT NULL,
  name       VARCHAR(160) NOT NULL,
  address    VARCHAR(255),
  -- Anchor for the site itself. A floor plan georeference (see floorplans
  -- below) is what turns a pin into a device coordinate; this is the coarser
  -- "where is this place" used by the map when a device has neither.
  lat        DECIMAL(10,7),
  lng        DECIMAL(10,7),
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sites_org (org_id)
);

-- Georeference for a floor plan image: the real-world coordinates of its
-- north-west and south-east corners. Without this a pin is only an x/y percent
-- of an image and cannot become a lat/lng — which is precisely what an ETERNITY
-- transformer needs, since the same asset has to appear on the GPS map. With
-- the two corners, x/y% ↔ lat/lng is a linear interpolation in both directions,
-- so dropping a pin fills the coordinate inputs and typing a coordinate moves
-- the pin.
--
-- Nullable throughout: a plan with no georeference still works for indoor
-- placement, it just cannot sync coordinates.
ALTER TABLE floorplans ADD COLUMN site_id VARCHAR(64) NULL AFTER floor_id;
ALTER TABLE floorplans ADD COLUMN nw_lat DECIMAL(10,7) NULL;
ALTER TABLE floorplans ADD COLUMN nw_lng DECIMAL(10,7) NULL;
ALTER TABLE floorplans ADD COLUMN se_lat DECIMAL(10,7) NULL;
ALTER TABLE floorplans ADD COLUMN se_lng DECIMAL(10,7) NULL;
ALTER TABLE floorplans ADD INDEX idx_floorplans_site (site_id);
