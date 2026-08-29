// Fails on MariaDB-only DDL in backend/sql/*.sql.
//
// WHY THIS EXISTS
// ---------------
// migrate-v54.sql shipped with:
//
//     ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS user_id ...
//     CREATE INDEX IF NOT EXISTS idx_nc_user ON notification_channels (...)
//
// `IF NOT EXISTS` on ADD COLUMN and on CREATE INDEX is MariaDB syntax. MySQL
// has neither, and it is a hard PARSE error — not a no-op, not a warning. The
// migration runner treats a non-ignorable error as fatal, so the run aborted on
// v54's very first statement and v54, v55, v56 and v57 never applied to ANY
// database. Every feature depending on those columns (per-user notification
// channels, report_schedules.domain, the widened scope/channel columns) was
// silently running against a schema that never got them.
//
// Nothing caught it: the file is valid SQL *somewhere*, it is never executed by
// any unit test, and the failure only appears when the migrate Job runs against
// a real MySQL.
//
// Idempotency does NOT need this syntax. backend/src/migrate.ts already treats
// ER_DUP_FIELDNAME / ER_DUP_KEYNAME / ER_TABLE_EXISTS_ERROR as expected on a
// re-run and continues, so the plain statement is both correct and re-runnable.
//
// Run from the repo root: node e2e/proofs/test-sql-mysql-dialect.mjs

import { readFileSync, readdirSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const DIR = new URL('../../backend/sql/', import.meta.url)
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

t('found migration files to check', files.length > 0, `${files.length} .sql files`)

// Each entry: [human name, regex, why MySQL rejects it]
const BANNED = [
  ['ADD COLUMN IF NOT EXISTS', /\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i,
   'MySQL has no IF NOT EXISTS on ADD COLUMN — the runner already tolerates ER_DUP_FIELDNAME'],
  ['ADD INDEX/KEY IF NOT EXISTS', /\bADD\s+(?:INDEX|KEY)\s+IF\s+NOT\s+EXISTS\b/i,
   'MySQL has no IF NOT EXISTS on ADD INDEX — the runner already tolerates ER_DUP_KEYNAME'],
  ['CREATE INDEX IF NOT EXISTS', /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i,
   'MySQL has no IF NOT EXISTS on CREATE INDEX — the runner already tolerates ER_DUP_KEYNAME'],
  ['DROP COLUMN IF EXISTS', /\bDROP\s+COLUMN\s+IF\s+EXISTS\b/i,
   'MySQL has no IF EXISTS on DROP COLUMN — the runner already tolerates ER_CANT_DROP_FIELD_OR_KEY'],
  ['DROP INDEX IF EXISTS', /\bDROP\s+INDEX\s+IF\s+EXISTS\b/i,
   'MySQL has no IF EXISTS on DROP INDEX — the runner already tolerates ER_CANT_DROP_FIELD_OR_KEY'],
  ['MODIFY COLUMN IF EXISTS', /\bMODIFY\s+COLUMN\s+IF\s+EXISTS\b/i,
   'MariaDB-only'],
  ['CHANGE COLUMN IF EXISTS', /\bCHANGE\s+COLUMN\s+IF\s+EXISTS\b/i,
   'MariaDB-only'],
]

// Strip -- line comments and /* */ blocks so a comment explaining the banned
// syntax (this repo now has several) does not itself trip the check.
const strip = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')

let offenders = 0
for (const file of files) {
  const sql = strip(readFileSync(new URL(file, DIR), 'utf8'))
  for (const [name, re, why] of BANNED) {
    const m = sql.match(re)
    if (m) {
      offenders++
      t(`${file} avoids "${name}"`, false, `${why}\n      matched: ${m[0]}`)
    }
  }
}

if (offenders === 0) {
  t(`no MariaDB-only DDL in any of the ${files.length} migrations`, true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
