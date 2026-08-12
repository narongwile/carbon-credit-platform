-- migrate-v46.sql — user status & pending approval workflow
USE iothub;

-- Add status column to users table (default 'active' for existing users)
ALTER TABLE users ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD INDEX (status);
