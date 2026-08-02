-- migrate-v22.sql — users.username as a real, stored login handle
--
-- The admin "New User" form has always had a Username field, and the login
-- screen has always labelled its first input "Username" — but there was no such
-- column. The form silently dropped the value (only email/name/role/department
-- were ever sent), the user list showed `email || id` in that column, and login
-- resolved strictly by email. So an admin typed a username, saved, and got back
-- an email address: the field looked functional and stored nothing.
--
-- It is stored now, and login accepts EITHER identifier. Unique per organization
-- rather than globally: two different customers may each have an "admin", and a
-- global constraint would let the first tenant to claim a name take it from
-- everyone else.
USE iothub;

ALTER TABLE users ADD COLUMN username VARCHAR(64) NULL AFTER email;

-- NULLs are exempt from a UNIQUE index in MySQL, so existing rows (which have no
-- username yet) do not collide with each other while they are being filled in.
ALTER TABLE users ADD UNIQUE KEY uq_users_org_username (org_id, username);
