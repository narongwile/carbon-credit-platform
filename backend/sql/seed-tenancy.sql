-- Demo tenancy seed (orgs, entitlements, departments, users, product access)
-- mirrors the frontend mock so the provisioning/admin APIs return data.
-- Platform ids match src/lib/platforms.ts. Idempotent. Run after schema.sql.
USE iothub;

INSERT IGNORE INTO organizations (id, name, status) VALUES
  ('org-1','KMUTT','active'),
  ('org-2','Factory Alpha','active'),
  ('org-3','Industrial Corp','active');

-- Licensed platforms per org (eternityTransformers / refrigerationDataLogger / bloodBox)
INSERT IGNORE INTO org_entitlements (org_id, platform) VALUES
  ('org-1','eternityTransformers'), ('org-1','refrigerationDataLogger'),
  ('org-2','eternityTransformers'), ('org-2','bloodBox'),
  ('org-3','eternityTransformers'), ('org-3','refrigerationDataLogger'), ('org-3','bloodBox');

INSERT IGNORE INTO departments (id, org_id, name) VALUES
  ('dept-1a','org-1','Operations'), ('dept-1b','org-1','Maintenance'),
  ('dept-2a','org-2','Plant Ops'),
  ('dept-3a','org-3','Facilities');

-- password_hash = bcrypt('demo1234') for all demo users
INSERT IGNORE INTO users (id, org_id, email, name, role, department_id, password_hash) VALUES
  ('u-admin1','org-1','admin@kmutt.demo','Org-1 Admin','admin','dept-1a','$2b$10$16mJwlPN1GG1HmaNyAQWK.1/G0OchMcBAScVdU.VWhLiSabfL34aS'),
  ('u-view1','org-1','viewer@kmutt.demo','Org-1 Viewer','viewer','dept-1a','$2b$10$16mJwlPN1GG1HmaNyAQWK.1/G0OchMcBAScVdU.VWhLiSabfL34aS'),
  ('u-admin2','org-2','admin@alpha.demo','Org-2 Admin','admin','dept-2a','$2b$10$16mJwlPN1GG1HmaNyAQWK.1/G0OchMcBAScVdU.VWhLiSabfL34aS'),
  ('u-super','','super@oneops.demo','Super Admin','superadmin',NULL,'$2b$10$16mJwlPN1GG1HmaNyAQWK.1/G0OchMcBAScVdU.VWhLiSabfL34aS');

-- Department product access (admin grant): dept → domain → level
INSERT IGNORE INTO product_access (scope, scope_id, domain, level) VALUES
  ('department','dept-1a','transformer','manage'),
  ('department','dept-1a','carbonNode','view'),
  ('department','dept-1b','transformer','view'),
  ('department','dept-2a','transformer','manage'),
  ('department','dept-2a','bloodBox','view'),
  ('department','dept-3a','transformer','view'),
  ('department','dept-3a','carbonNode','view'),
  ('department','dept-3a','bloodBox','view'),
  -- per-user override (restrict viewer to view-only transformer)
  ('user','u-view1','transformer','view');
