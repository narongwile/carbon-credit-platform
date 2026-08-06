-- migrate-v38.sql — a category on each maintenance document
--
-- "Maintenance Documents" held one undifferentiated pile: a service report, a
-- calibration certificate and a test result all looked the same in the list,
-- distinguishable only by reading the filename. 'kind' gives the same sorting
-- the device photo gallery already has (node_photos.kind, migrate-v36) — a
-- fixed small vocabulary an admin picks at upload time, not a free-text field
-- nobody would fill in consistently.
--
-- Defaulting existing rows to 'other' is deliberately honest: a document
-- uploaded before this existed was never categorised, and guessing its kind
-- from a filename would be wrong often enough to be worse than admitting it
-- is unsorted.
USE iothub;

ALTER TABLE documents
  ADD COLUMN kind VARCHAR(24) NOT NULL DEFAULT 'other';

ALTER TABLE documents
  ADD INDEX idx_documents_kind (node_id, kind);
