-- migrate-v33.sql — per-org "show the generic 3D model" toggle.
--
-- The device detail pages (FixDashboard's twin slot, TransformerDetailView's
-- 3D canvas) show the admin-uploaded real photo (node_images, migrate-v27)
-- when one exists, and otherwise fall back to a generic 3D render — labelled
-- "Generic model — not this unit" so it is never mistaken for the real unit.
-- Some orgs would rather see nothing 3D at all while a device has no photo
-- yet, not even the honestly-labelled placeholder. This is that switch,
-- superadmin-only, one row per org.
--
-- organizations lives in the CONTROL database only (routing/auth/superadmin
-- management), never per-tenant — same as status, logo_url, lat/lng already
-- on this table. Defaults to 1 (today's behavior, unchanged) so every
-- existing org keeps showing the 3D fallback until a superadmin turns it off.
USE iothub;

ALTER TABLE organizations ADD COLUMN show_3d_fallback TINYINT(1) NOT NULL DEFAULT 1;
