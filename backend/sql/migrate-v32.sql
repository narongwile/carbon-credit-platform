-- migrate-v32.sql — transformer model catalog, per-org.
--
-- Every transformer nameplate today is typed in from scratch, per unit
-- (NameplateEditor, migrate-v31). For a factory-fed fleet where the same
-- handful of model codes repeat across dozens of units (ETERNITY IS a
-- transformer manufacturing platform), that means retyping the identical
-- manufacturer/kVA/voltage/cooling combination on every single approval —
-- and migrate-v31's own demo seed proves how that goes wrong even done once,
-- by one person: TR-6787 shipped at three different kVA/voltage combinations
-- across 11 rows, because there was nowhere to define "TR-6787" once.
--
-- This table lives in the ORG database — same placement as node_nameplates,
-- event_problems, org_domain_rules — because a catalog readable across tenant
-- databases is exactly the kind of cross-org data leak TENANT_DB_MODE exists
-- to prevent. There is no shared "ETERNITY master catalog": every org keeps
-- its own copy of even a model code every org happens to use, the same way
-- every org keeps its own copy of event_problems even where two orgs define
-- an identical root-cause label. org_id is NOT NULL and every query filters
-- by it — required (not just belt-and-suspenders) because org-1/org-2/org-3
-- share the single control-DB physical database (resolvePool() only
-- separates a physical database per org once TENANT_DB_MODE routes an org to
-- its own iothub_<org>); without the column, those three orgs' catalogs would
-- collide in one table.
--
-- node_nameplates.model_id is nullable and additive: every existing row keeps
-- working exactly as it does today. Where an admin picks a model, the
-- existing manufacturer/model/rated_kva/voltage_class/cooling_type columns on
-- that row change MEANING from "the value" to "the override" — NULL inherits
-- the model's value, a value means this specific unit differs from the
-- standard. That is a deliberate design choice, not a shortcut: a factory
-- model has real variants (a site that ordered a non-standard secondary
-- voltage, a different tap), and a rigid "catalog value always wins" rule
-- would just push admins back to never using the catalog at all.
USE iothub;

CREATE TABLE IF NOT EXISTS transformer_models (
  id             VARCHAR(64) PRIMARY KEY,
  org_id         VARCHAR(64) NOT NULL,
  model_code     VARCHAR(120) NOT NULL,
  manufacturer   VARCHAR(120),
  rated_kva      DECIMAL(10,2),
  voltage_class  VARCHAR(64),
  cooling_type   VARCHAR(32),
  -- Retired models stay (units already pointing at them must keep resolving)
  -- but drop out of the picker offered on new approvals.
  active         TINYINT(1) NOT NULL DEFAULT 1,
  created_by     VARCHAR(120),
  created_at     DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX (org_id), INDEX (active)
);

ALTER TABLE node_nameplates ADD COLUMN model_id VARCHAR(64) NULL AFTER node_id;
ALTER TABLE node_nameplates ADD INDEX idx_nameplates_model (model_id);

-- Seed: the three model codes migrate-v31 already introduced (TR-6787,
-- TR-5512, TR-9001), as real per-org catalog rows, then repoint each demo
-- org's nameplates at them. A unit whose migrate-v31 values already matched
-- the standard spec now inherits (its literal columns clear to NULL); the
-- three units that disagreed with the rest — tr-003, tr-301, tr-302, tr-303 —
-- keep their real values as an explicit per-unit override instead of being
-- "fixed" to match. They were never data-entry noise; they are exactly the
-- case this table exists for.
INSERT INTO transformer_models (id, org_id, model_code, rated_kva, voltage_class) VALUES
  ('tm-org1-6787','org-1','TR-6787',2500,'22kV/0.4kV'),
  ('tm-org1-5512','org-1','TR-5512',1500,'11kV/0.4kV'),
  ('tm-org1-9001','org-1','TR-9001',3000,'33kV/11kV'),
  ('tm-org2-6787','org-2','TR-6787',2500,'22kV/0.4kV'),
  ('tm-org2-5512','org-2','TR-5512',1500,'11kV/0.4kV'),
  ('tm-org2-9001','org-2','TR-9001',3000,'33kV/11kV'),
  ('tm-org3-6787','org-3','TR-6787',2500,'22kV/0.4kV'),
  ('tm-org3-5512','org-3','TR-5512',1500,'11kV/0.4kV'),
  ('tm-org3-9001','org-3','TR-9001',3000,'33kV/11kV')
ON DUPLICATE KEY UPDATE model_code=VALUES(model_code);

UPDATE node_nameplates SET model_id='tm-org1-6787', rated_kva=NULL, voltage_class=NULL WHERE node_id='tr-001';
UPDATE node_nameplates SET model_id='tm-org1-5512', rated_kva=NULL, voltage_class=NULL WHERE node_id='tr-002';
UPDATE node_nameplates SET model_id='tm-org1-6787'                                     WHERE node_id='tr-003'; -- kVA override: 2000 vs standard 2500
UPDATE node_nameplates SET model_id='tm-org1-9001', rated_kva=NULL, voltage_class=NULL WHERE node_id='tr-004';
UPDATE node_nameplates SET model_id='tm-org1-5512', rated_kva=NULL, voltage_class=NULL WHERE node_id='tr-005';
UPDATE node_nameplates SET model_id='tm-org2-9001', rated_kva=NULL, voltage_class=NULL WHERE node_id='tr-101';
UPDATE node_nameplates SET model_id='tm-org2-6787', rated_kva=NULL, voltage_class=NULL WHERE node_id='tr-102';
UPDATE node_nameplates SET model_id='tm-org2-5512', rated_kva=NULL, voltage_class=NULL WHERE node_id='tr-103';
UPDATE node_nameplates SET model_id='tm-org3-9001'                                     WHERE node_id='tr-301'; -- voltage override: 115kV/22kV vs standard 33kV/11kV
UPDATE node_nameplates SET model_id='tm-org3-6787'                                     WHERE node_id='tr-302'; -- voltage override: 33kV/11kV vs standard 22kV/0.4kV
UPDATE node_nameplates SET model_id='tm-org3-5512'                                     WHERE node_id='tr-303'; -- kVA+voltage override
