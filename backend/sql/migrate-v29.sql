-- migrate-v29.sql — which of the customer's sites a department may see
--
-- Sites became real rows in v21 and devices hang off them, but nothing scoped a
-- USER to one. An ETERNITY customer running a dozen plants had every one of its
-- viewers seeing every transformer at every plant: the device list, the sensor
-- map, the floor plans and the alarm feed are all driven by the same fleet
-- query, and it filtered by organization and department but never by place.
--
-- The department is the unit, not the user. Product access, dashboard themes and
-- displayed parameters are all granted per department already, and "the Rayong
-- maintenance team" is the thing an admin actually thinks in. A user in several
-- departments gets the union of their sites — being added to a second team must
-- never take access away, the same rule the rest of this schema follows.
--
-- NO ROWS FOR A DEPARTMENT MEANS NO RESTRICTION. Fail-open is deliberate and is
-- the only safe default here: every department that exists today has no rows, so
-- a fail-closed reading would empty the device list, the map, the floor plans and
-- the alarm page for every non-admin user on the platform the moment this
-- deploys. An admin opts a department into site scoping by assigning it one.
USE iothub;

CREATE TABLE IF NOT EXISTS department_sites (
  department_id VARCHAR(64) NOT NULL,
  site_id       VARCHAR(64) NOT NULL,
  -- Denormalised so an org's whole policy can be read, and wiped when a site is
  -- deleted, without joining departments.
  org_id        VARCHAR(64) NOT NULL,
  PRIMARY KEY (department_id, site_id),
  INDEX idx_department_sites_org (org_id),
  INDEX idx_department_sites_site (site_id)
);
