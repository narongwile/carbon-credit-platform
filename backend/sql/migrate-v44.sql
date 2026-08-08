-- migrate-v44.sql — a maintenance entry can be a NOTE, not only a file
--
-- documents required an uploaded file: docsPostFunc takes dataBase64 and the
-- UI's only action is "Upload". But a lot of real maintenance history has no
-- document behind it — "topped up oil, 2L, no report issued", "customer
-- reported humming, inspected, nothing found", "vendor visit rescheduled".
-- Today that either goes unrecorded or gets typed into a filename, which is
-- how you end up with a row called "checked_oil_level_nothing_wrong_no_doc.pdf"
-- and no file attached to it.
--
-- `note` is additive on purpose: an entry may now be
--   · a file (as today, note NULL),
--   · a note with no file (data NULL — the column is already nullable), or
--   · a file WITH a note explaining what it is.
-- Nothing about existing rows changes, and the read path already tolerates a
-- NULL data column, so a note-only row needs no special case there.
USE iothub;

ALTER TABLE documents ADD COLUMN note TEXT NULL;
