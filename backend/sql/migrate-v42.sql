-- migrate-v42.sql — limit an individual USER to specific devices
--
-- Device visibility has only ever been a DEPARTMENT question:
-- node_departments (v35) grants a device to a set of departments, and
-- deptVisible() checks the caller's departmentIds against it. product_access
-- can narrow a single user, but only to a whole PRODUCT LINE (transformer /
-- carbonNode / bloodBox) — never to particular devices. So "this contractor
-- may see these three transformers and nothing else" could not be expressed:
-- the only way was to invent a department per person, which does not scale and
-- silently changes alarm routing (nodes.department_id) along the way.
--
-- RESTRICT, NEVER GRANT. A row here can only ever NARROW what the department
-- rules already allow — it is an allow-list applied on top of them, not a way
-- around them. Concretely: a user listed for a device still cannot see it
-- unless their department could see it anyway. This keeps one rule true across
-- the whole schema — department grants are the ceiling, everything else only
-- lowers it — and means this table can never become a back door that widens
-- access, which an additive design would risk every time someone edits it.
--
-- NO ROWS FOR A USER MEANS NO RESTRICTION, the same fail-open rule v29
-- (department_sites) and v35 (node_departments) state in their own comments,
-- and the one product_access got wrong (see migrate-v41's sibling fix in
-- accessFor). Every user on the platform has no rows here the moment this
-- deploys, so a fail-closed reading would blank every viewer's device list at
-- once. An admin opts a user into per-device scoping by giving them a first
-- row — and that is exactly the moment the UI has to warn, because it flips
-- them from "everything their department allows" to "only what is listed".
--
-- Lives in the ORG database (like node_departments, and unlike users, which
-- stays in the control DB): it is keyed on node_id and is read on the device
-- read path, so it belongs beside the nodes it describes.
USE iothub;

CREATE TABLE IF NOT EXISTS node_user_visibility (
  user_id    VARCHAR(64) NOT NULL,
  node_id    VARCHAR(64) NOT NULL,
  -- Denormalised so one org's whole per-user policy can be read in a single
  -- indexed query, and wiped with the org, without joining users or nodes —
  -- the same reason node_departments and department_sites carry it.
  org_id     VARCHAR(64) NOT NULL,
  granted_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, node_id),
  INDEX idx_nuv_org (org_id),
  INDEX idx_nuv_node (node_id)
);
