-- migrate-v23.sql — dashboard themes granted per department
--
-- The "Dashboard View Permission" tab has always rendered: it lists the
-- organization's departments, shows the themes the superadmin licensed, and
-- lets an admin toggle them. None of it was stored. Departments were loaded
-- with a hardcoded themeIds: ['th-overview'], every toggle lived in React state
-- only, and a reload put it back — so the screen described a policy the system
-- did not have.
--
-- A join table rather than a JSON column on departments: the question actually
-- asked at render time is "which departments may see this theme", and the
-- reverse, "which themes may this department see" — both are one indexed lookup
-- here, and a theme being revoked org-wide is one DELETE.
USE iothub;

CREATE TABLE IF NOT EXISTS department_themes (
  department_id VARCHAR(64)  NOT NULL,
  theme_id      VARCHAR(64)  NOT NULL,
  -- Denormalised so the org's whole policy can be read (and wiped, on
  -- provisioning changes) without joining departments.
  org_id        VARCHAR(64)  NOT NULL,
  PRIMARY KEY (department_id, theme_id),
  INDEX idx_dept_themes_org (org_id)
);
