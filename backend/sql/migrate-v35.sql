-- migrate-v35.sql — which DEPARTMENTS may see each device.
--
-- Today a device belongs to at most one department (nodes.department_id, set
-- at approval) and the visibility rule everywhere is:
--   department_id IS NULL -> everyone in the org sees it
--   department_id = X     -> only department X sees it
--
-- That cannot express the thing an admin actually needs, which is a SET. The
-- immediate case is a "customer" department — the end customer who owns the
-- transformer should see their own unit, while Maintenance and Operations
-- also see it. With a single column the only options are "only the customer"
-- or "the whole organization", and neither is right.
--
-- department_sites (v29) does not solve it either: it scopes a department to
-- whole SITES. Two departments needing different devices AT THE SAME SITE —
-- exactly the customer case, since a customer's transformer sits in the same
-- substation as everything else — is not expressible there at all. The two
-- are complementary and both still apply: site scoping stays a separate
-- narrowing on top of this.
--
-- Semantics, chosen to be strictly backward compatible:
--   no rows for a node  -> fall back to nodes.department_id exactly as before
--                          (so every existing device keeps its current
--                          visibility without a data migration)
--   rows for a node     -> that set is authoritative; any department in it
--                          sees the device, and nodes.department_id no longer
--                          decides visibility
--
-- nodes.department_id is NOT removed and NOT redundant: it stays the OWNING
-- department — the one an alarm is routed to (notification_channels,
-- alarm_events.department_id) and the one Device Management assigns. This
-- table answers "who may look", which is a different question from "whose
-- device is it".
--
-- Lives in the ORG database beside `nodes`, like every other per-device table
-- (node_nameplates, node_images): a grant for a device that is not in the same
-- database as the device is a row nothing can join to.
USE iothub;

CREATE TABLE IF NOT EXISTS node_departments (
  node_id       VARCHAR(64) NOT NULL,
  department_id VARCHAR(64) NOT NULL,
  -- Denormalised so a whole org's grants are one indexed read on the fleet
  -- path, which filters every node on every page load.
  org_id        VARCHAR(64) NOT NULL,
  granted_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (node_id, department_id),
  INDEX idx_node_departments_org (org_id),
  INDEX idx_node_departments_dept (department_id)
);
