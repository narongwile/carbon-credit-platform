-- migrate-v24.sql — org logos as bytes, not a data URL in organizations
--
-- Uploading a logo returned 500. The Settings page sends the image as a base64
-- data: URL and brandingPut wrote it straight into organizations.logo_url,
-- which is TEXT — 65,535 bytes. Base64 inflates by ~4/3, so the page's own
-- 512 KB limit produces roughly 683 KB and even a modest 100 KB PNG lands near
-- 137 KB. Under MySQL 8's default STRICT_TRANS_TABLES that is ER_DATA_TOO_LONG
-- (1406), an error rather than a silent truncation — so effectively every real
-- logo failed, the row was never written, and a refresh showed the default.
--
-- Widening the column would have fixed the write and created a worse problem:
-- GET /api/orgs does SELECT * and runs on every page load (the sidebar brand
-- hydrates from it), so each org's full base64 would ship on every navigation.
-- The bytes live in their own table and are served by their own endpoint —
-- exactly what floorplans already do — leaving logo_url holding only the short
-- path to them.
USE iothub;

CREATE TABLE IF NOT EXISTS org_logos (
  org_id       VARCHAR(64) PRIMARY KEY,
  image_data   LONGBLOB,
  content_type VARCHAR(100),
  updated_at   DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);
