-- migrate-v25.sql — a user can belong to more than one department
--
-- The admin form has always offered "Assign Departments (organize)" as a
-- multi-select, and the type behind it is departmentIds: string[]. Storage was
-- never plural: users.department_id is a single column, and saveUser sent
-- departmentIds[0]. Picking three departments silently kept the first and
-- discarded the rest, and every access decision downstream (product_access,
-- the fleet's department filter, dashboard-theme visibility) then reasoned
-- about one department the admin may not even have meant.
--
-- users.department_id is kept and mirrors the FIRST membership, so existing
-- queries that read it keep working while callers migrate to the set.
USE iothub;

CREATE TABLE IF NOT EXISTS user_departments (
  user_id       VARCHAR(64) NOT NULL,
  department_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (user_id, department_id),
  INDEX idx_user_departments_dept (department_id)
);

-- Backfill from the column so nobody loses the membership they already had.
INSERT IGNORE INTO user_departments (user_id, department_id)
SELECT id, department_id FROM users WHERE department_id IS NOT NULL AND department_id <> '';
