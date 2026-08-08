-- migrate-v43.sql — custom subject and message body for scheduled reports
--
-- reportRunFunc hardcoded both:
--     subject: 'ONEOPS Report: ' + s.name
--     text:    'Automated ' + s.sequence + ' ' + s.scope + ' report.'
-- and the Telegram caption the same way. Every customer's every report
-- therefore arrived with our product name in the subject line and a sentence
-- of English boilerplate in the body. For a Thai factory forwarding these to
-- their own maintenance team, neither is usable, and there was no way to
-- change either one.
--
-- Both are nullable: NULL means "use the built-in default", so every existing
-- schedule keeps sending exactly what it sends today and only a schedule
-- somebody deliberately edits changes.
--
-- Placeholders are substituted at send time (see reportRunFunc):
--   {name} {sequence} {scope} {org} {date} {devices} {rows}
-- Kept deliberately small and literal — no expression language, no
-- conditionals. This text is composed by an admin in a form field and then
-- interpolated into an email subject and a Telegram caption; anything richer
-- becomes a templating engine that has to be escaped for two different sinks.
USE iothub;

-- VARCHAR, not TEXT: a subject line longer than this is truncated by mail
-- clients anyway, and the limit makes the field self-documenting in the UI.
ALTER TABLE report_schedules ADD COLUMN subject_template VARCHAR(255) NULL;

-- The message body / Telegram caption. TEXT because an operator may
-- reasonably want a short paragraph of instructions for whoever receives it.
ALTER TABLE report_schedules ADD COLUMN body_template TEXT NULL;
