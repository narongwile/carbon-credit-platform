-- migrate-v41.sql — scheduled reports: a real send time, and recipients you pick
--
-- report_schedules could express "daily, CSV, email, to this text box" and
-- nothing more. Two things were wrong with that in production:
--
-- 1. THERE WAS NO SEND TIME. next_run_at was set to NOW()+INTERVAL, so a
--    "daily" report fired at whatever minute the schedule happened to be
--    created, and then DRIFTED: the cron ticks every 15 minutes and picks up
--    anything already due, so each run pushed the next one later by up to a
--    quarter of an hour. A report created at 14:37 was arriving mid-afternoon
--    and creeping later every day, which is useless for "the morning shift
--    report". Weekly and monthly had no way to say which day at all.
--
-- 2. RECIPIENTS WERE A TEXT BOX. Whoever created the schedule typed addresses
--    by hand, so a new maintenance engineer joined the department and kept not
--    receiving the report until somebody remembered to edit every schedule,
--    and a leaver kept receiving it forever. The organization already knows who
--    is in which department — the schedule should ask it rather than making an
--    admin restate it and maintain it.
--
-- Times are stored as WALL CLOCK in the deployment timezone, not UTC. Every
-- pool in this backend sets `SET time_zone = DB_TZ` (default '+07:00'), so
-- NOW(3) already IS local wall time and the scheduler can compare against
-- send_hour/send_minute directly. Storing UTC here would mean converting on
-- every read for no gain, and would make a stored "08:00" stop meaning 08:00
-- if the deployment ever moved zones — which is the opposite of what an
-- operator asking for an 8am report wants.
USE iothub;

-- ONE ALTER PER COLUMN, deliberately, even though a single multi-clause ALTER
-- would be shorter. The migration runner tolerates ER_DUP_FIELDNAME so a file
-- can be re-applied (migrate.ts), but it does that PER STATEMENT — and a
-- multi-clause `ALTER TABLE t ADD a, ADD b, ADD c` is one statement. If any one
-- of those columns already existed, MySQL would raise duplicate-column for the
-- whole thing, the runner would swallow it as "expected on re-runs", and the
-- OTHER columns would never be added while the file was still recorded as
-- applied. The scheduler would then fail at runtime on a missing column with
-- the ledger insisting the schema was current. Split like this, each column is
-- independently idempotent.

-- When to send, in DB_TZ wall clock. The scheduler tick runs every 15 minutes,
-- so send_minute is only meaningful at 0/15/30/45 — the UI offers exactly
-- those, rather than a free minute field that silently rounds.
ALTER TABLE report_schedules ADD COLUMN send_hour   TINYINT NOT NULL DEFAULT 7;
ALTER TABLE report_schedules ADD COLUMN send_minute TINYINT NOT NULL DEFAULT 0;

-- Weekly: which day. 1=Monday … 7=Sunday (ISO-8601, matching WEEKDAY()+1 in
-- MySQL). NULL for daily/monthly schedules.
ALTER TABLE report_schedules ADD COLUMN day_of_week TINYINT NULL;

-- Monthly: which date. Capped at 28 by the application on purpose — a schedule
-- set to the 30th would simply not exist in February, and "silently skips one
-- month a year" is a worse failure than "runs on the 28th".
ALTER TABLE report_schedules ADD COLUMN day_of_month TINYINT NULL;

-- How far back the report's data window reaches. NULL keeps the old behaviour
-- of deriving it from the sequence (daily=1, weekly=7, monthly=30), so every
-- existing row behaves exactly as it did before this migration. Set it to
-- decouple "how often it arrives" from "how much it covers" — a daily email
-- summarising the trailing 7 days is a common ask and could not be expressed.
ALTER TABLE report_schedules ADD COLUMN window_days SMALLINT NULL;

-- Who receives it.
--   'manual'     — recipients column, as before (and the only mode that makes
--                  sense for telegram, where the destination is a chat id).
--   'department' — everyone in the listed departments, resolved at SEND time so
--                  joiners and leavers are handled without editing this row.
--   'users'      — the listed users specifically.
-- Deliberately not an ENUM: these modes are the ones that will grow (roles,
-- on-call rotations), and every past ENUM widening here needed its own migration.
ALTER TABLE report_schedules ADD COLUMN recipient_mode VARCHAR(16) NOT NULL DEFAULT 'manual';

-- Comma-separated ids, resolved to addresses at send time. Ids rather than a
-- snapshot of addresses is the whole point: the address list must be a QUESTION
-- asked of the directory each run, not an answer frozen at the moment somebody
-- filled the form in.
ALTER TABLE report_schedules ADD COLUMN recipient_dept_ids VARCHAR(1000) NULL;
ALTER TABLE report_schedules ADD COLUMN recipient_user_ids TEXT NULL;

-- Every existing row keeps working: recipient_mode defaults to 'manual' and
-- window_days stays NULL, so the only visible change to an untouched schedule
-- is that it now fires at a stable 07:00 instead of drifting. Rows created
-- before this migration have no meaningful creation-time-of-day to preserve —
-- the drift means the current firing time is already arbitrary.
