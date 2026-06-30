-- ONEOPS — fresh-install migration (run order for an EMPTY database).
-- Run from the sql/ directory:  cd backend/sql && mysql -h HOST -u admin -p < install.sql
-- (SOURCE resolves paths from the client's working directory.)
--
-- For a FRESH DB you do NOT run any migrate-v*.sql — schema.sql already contains
-- every table/column. The migrate-v*.sql files are ONLY for upgrading an
-- existing DB that predates a feature.

SOURCE schema.sql;        -- 1) core schema (creates db `iothub` + all core tables)
SOURCE bloodbox.sql;      -- 2) BloodBOX domain tables
SOURCE seed-nodes.sql;    -- 3) (optional) demo fleet: nodes + geo + mqtt_prefix
SOURCE seed-tenancy.sql;  -- 4) (optional) demo orgs/users/entitlements/event-problems

SELECT 'ONEOPS schema installed' AS status;
