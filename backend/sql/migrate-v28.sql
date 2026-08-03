-- migrate-v28.sql — department-scoped parameter display, and theme grants that
-- are actually stored
--
-- Two halves of the same complaint: the admin screens describe policies the
-- database cannot hold.
--
-- 1) display_params (v26) is keyed org+domain+node. An admin can say "a
--    transformer shows these six values" but not "Maintenance sees oil and gas,
--    Operations sees load and voltage" — and on a forty-parameter merged asset
--    that is the distinction that makes the page readable for either team.
--    department_id NULL keeps its existing meaning: everyone in the org.
--
-- 2) The set of dashboard themes an organization may use lived in a frontend
--    const (orgThemes.ts) covering org-1/2/3 and nothing else. Every other
--    organization fell back to ['th-overview'], so its admin could grant exactly
--    one theme no matter what the superadmin intended, and the superadmin's own
--    "save" mutated a module-level object that a page reload discarded. The
--    Dashboard View Permission tab has been reading an entitlement nobody could
--    write.
USE iothub;

-- --- 1) department scope for displayed parameters ---------------------------
ALTER TABLE display_params ADD COLUMN department_id VARCHAR(64) NULL;

-- Same trick as node_scope in v26, for the same reason: MySQL treats NULLs as
-- distinct in a UNIQUE index, which is exactly wrong for "one row per org-wide
-- default". Both scopes need a sentinel before they can share a key.
ALTER TABLE display_params ADD COLUMN dept_scope VARCHAR(64)
  AS (IFNULL(department_id, '*')) STORED;

-- The old key had no department column, so an org-wide row and a per-department
-- row for the same parameter would collide and the INSERT IGNORE would silently
-- drop the second one.
ALTER TABLE display_params DROP INDEX uq_display_params;
ALTER TABLE display_params
  ADD UNIQUE KEY uq_display_params (org_id, domain, node_scope, dept_scope, param_key);
ALTER TABLE display_params
  ADD INDEX idx_display_params_dept (org_id, domain, dept_scope);

-- --- 2) which themes an organization is entitled to --------------------------
-- Superadmin writes it, the org's admin can only allocate from it. Rows rather
-- than a JSON column: "is this org entitled to this theme" is the question asked
-- on every render of the permission tab, and revoking one is a single DELETE.
CREATE TABLE IF NOT EXISTS org_theme_grants (
  org_id     VARCHAR(64) NOT NULL,
  theme_id   VARCHAR(64) NOT NULL,
  granted_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (org_id, theme_id)
);

-- Seed the three demo orgs with what orgThemes.ts hardcoded, so switching the
-- screen from the frontend const to the table is not a silent downgrade for the
-- orgs that already had grants. INSERT IGNORE: an org that has since been given
-- real grants keeps them.
INSERT IGNORE INTO org_theme_grants (org_id, theme_id) VALUES
  ('org-1','th-overview'),('org-1','th-map'),('org-1','th-fix'),('org-1','th-free'),('org-1','th-refrig'),
  ('org-2','th-overview'),('org-2','th-map'),('org-2','th-fix'),('org-2','th-free'),('org-2','th-twin'),
  ('org-3','th-overview'),('org-3','th-fix');
