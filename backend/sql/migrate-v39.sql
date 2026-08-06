-- migrate-v39.sql — the date a document IS, separate from when it was uploaded
--
-- documents.created_at is an upload timestamp, and it was the only date the
-- list had. For maintenance records those are routinely months apart: a
-- service report for work done in March gets scanned and uploaded in June, an
-- annual test certificate is dated the day of the test, not the day someone
-- got round to filing it. Sorting or reporting on created_at answers "when was
-- this filed", which is almost never the question — "was this unit serviced
-- last quarter?" needs the document's own date.
--
-- Both are kept. created_at stays exactly as it was (an audit fact: who filed
-- what, when), and doc_date is what the document itself says. Nullable, and
-- the read path falls back to created_at, so every row uploaded before this
-- existed keeps showing a sensible date instead of a blank column.
--
-- DATE, not DATETIME: a service report is dated to the day. Storing a
-- meaningless 00:00:00 alongside it would invite the same timezone-shift bug
-- this codebase has already hit twice on real timestamps.
USE iothub;

ALTER TABLE documents
  ADD COLUMN doc_date DATE NULL;

-- Sorting the list by the document's own date is the common read.
ALTER TABLE documents
  ADD INDEX idx_documents_doc_date (node_id, doc_date);
