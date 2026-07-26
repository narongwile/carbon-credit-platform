-- Migration v7 — auth (password hashes for login → JWT).
-- Fresh installs get password_hash from schema.sql. Run once on an existing DB.
USE iothub;
ALTER TABLE users ADD COLUMN password_hash VARCHAR(120);
ALTER TABLE users ADD UNIQUE KEY uq_email (email);
-- demo password 'demo1234' for the seeded users
UPDATE users SET password_hash='$2b$10$16mJwlPN1GG1HmaNyAQWK.1/G0OchMcBAScVdU.VWhLiSabfL34aS'
  WHERE id IN ('u-admin1','u-view1','u-admin2','u-super');
