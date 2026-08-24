-- migrate-v52.sql — restrict a displayed-parameter selection to specific
-- people, not just a whole department
--
-- display_params (v26/v28) already answers "org default" and "this
-- department's set" via department_id. A department is the right
-- granularity most of the time, but not always: an admin who wants exactly
-- one engineer — not their whole maintenance team — to see a diagnostic-only
-- parameter set had no way to say so short of creating a department of one.
--
-- Same trick as department_id/dept_scope (v28) and node_id/node_scope (v26):
-- a nullable user_id column plus a generated sentinel column for the unique
-- key, since MySQL treats NULL as distinct-from-itself in a UNIQUE index and
-- "one row per (node, department, org-wide-person) combination" needs every
-- optional scope collapsed to a comparable value.
--
-- user_id is deliberately NOT a sub-scope of department_id (both nullable,
-- independent): naming a person is meant to cut across departments, not
-- narrow one — "this one engineer regardless of which team they're on
-- today" is the case a department-of-one would otherwise be needed for.
USE iothub;

ALTER TABLE display_params ADD COLUMN user_id VARCHAR(64) NULL;
ALTER TABLE display_params ADD COLUMN user_scope VARCHAR(64)
  AS (IFNULL(user_id, '*')) STORED;

ALTER TABLE display_params DROP INDEX uq_display_params;
ALTER TABLE display_params
  ADD UNIQUE KEY uq_display_params (org_id, domain, node_scope, dept_scope, user_scope, param_key);
ALTER TABLE display_params
  ADD INDEX idx_display_params_user (org_id, domain, user_scope);
