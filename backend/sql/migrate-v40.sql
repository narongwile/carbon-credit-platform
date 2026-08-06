-- migrate-v40.sql — per-org catalog for photo kinds and document kinds
--
-- node_photos.kind and documents.kind were validated against two arrays
-- hardcoded in the generator (overview/nameplate/tapchanger/thermal/condition/
-- other; service_report/certificate/test_result/invoice/manual/other). That is
-- a guess at every customer's documentation practice made by whoever wrote the
-- array. A Thai utility files ใบรับรอง กฟภ., a DGA test result and a
-- commissioning sheet; none of those exist in that list, and there was no way
-- to add them.
--
-- Same shape as transformer_models (migrate-v32), which set the precedent for
-- "a list the admin owns, per org, in the org's own database":
--   · rows carry org_id and live beside nodes, never in a shared table;
--   · `active` retires an entry (it stops being OFFERED for new uploads)
--     rather than deleting it, so rows already carrying that kind keep
--     resolving to a real label forever;
--   · a hard delete is refused while anything still references the kind.
--
-- The BUILT-IN kinds are deliberately NOT seeded into this table. They stay in
-- code and are merged in at read time, with a row here overriding a built-in's
-- label/hint/order/visibility when kind_key matches. Three reasons:
--   · a new org works with zero rows here, exactly as it does today;
--   · a built-in cannot be lost by a bad DELETE — there is nothing to delete;
--   · some built-ins carry BEHAVIOUR, not just a label. 'thermal' paired with
--     'overview'/'condition' is what drives the IR compare slider, 'overview'
--     is the server-side fallback for an unrecognised kind and the column
--     default. Those must not become an admin's to remove — so `active=0`
--     only stops a kind being offered for NEW uploads and never affects reads
--     or validation of what is already stored.
USE iothub;

CREATE TABLE IF NOT EXISTS kind_catalog (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id     VARCHAR(64) NOT NULL,
  -- 'photo' → node_photos.kind, 'document' → documents.kind. One table, since
  -- the two are the same question asked about different attachments, and a
  -- single endpoint pair serves both.
  scope      VARCHAR(16) NOT NULL,
  -- The value actually stored on the row (node_photos.kind / documents.kind).
  -- Matches VARCHAR(24) on both of those columns.
  kind_key   VARCHAR(24) NOT NULL,
  label      VARCHAR(120) NOT NULL,
  hint       VARCHAR(255) NULL,
  position   INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120),
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- One row per key per scope per org: this is what makes a row an OVERRIDE of
  -- a built-in rather than a duplicate of it.
  UNIQUE KEY uq_kind_catalog (org_id, scope, kind_key),
  INDEX idx_kind_catalog_scope (org_id, scope, position)
);
