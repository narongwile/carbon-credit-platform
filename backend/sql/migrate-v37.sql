-- migrate-v37.sql — a shown parameter can be a big card or a compact row
--
-- display_params (v26/v28) already answers "which parameters does this
-- device/department show" — but every one of them rendered as a full sensor
-- card: an icon, a number, a sparkline, a status pill. That is the right
-- amount of space for the handful of numbers someone actually watches (oil
-- temp, load), and far too much for a merged two-topic transformer's other
-- twenty-odd values, which just need to be visible and checkable at a glance.
--
-- 'layout' lets an admin demote a shown parameter to a dense list row instead
-- of hiding it — the choice this schema was missing between "big card" and
-- "gone". Defaulting every existing row to 'card' changes nothing for a
-- selection an admin already made; the compact row is opt-in from here on.
USE iothub;

ALTER TABLE display_params
  ADD COLUMN layout VARCHAR(8) NOT NULL DEFAULT 'card';
