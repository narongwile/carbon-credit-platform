// The Automated Sequences panel must tell an operator whether the automation
// is actually running.
//
// WHAT WAS WRONG
// --------------
// 1. Run state was fetched and thrown away.
//
//    report_schedules has carried last_run_at and next_run_at since migrate-v4,
//    the Node-RED runner maintains them —
//
//        SELECT * FROM report_schedules
//         WHERE enabled=1 AND (next_run_at IS NULL OR next_run_at<=NOW(3))
//        ...
//        UPDATE report_schedules SET last_run_at=NOW(3), next_run_at=? WHERE id=?
//
//    — and api.ts's ReportScheduleRow declares both. The page's row mapper
//    listed every other column and omitted these two, so the table showed name,
//    domain, scope, frequency, window, channel and an enabled toggle, and
//    nothing about whether the job had EVER run.
//
//    For a scheduled job that is the whole question. A sequence that has been
//    failing for a month, or that was created and never fired, rendered exactly
//    like one that ran an hour ago — beneath a header counting it as an
//    "Active Cron". "Enabled" is an intent; "last ran at" is an outcome, and
//    only the outcome tells an operator whether to go looking.
//
// 2. A failed fetch left three fabricated schedules on screen.
//
//    api.listSchedules returns null when the request fails, and the loader did
//    `if (cancelled || !rows) return` — leaving the seeded demo rows from
//    lib/orgData: "Daily Cold-Chain Summary" and "Weekly Transformer Health"
//    (both enabled) plus "Monthly Compliance Export", pointing at departments
//    dept-bb / dept-dd and device dev-1 that belong to the demo fixture. The
//    header then read "2 Active Crons". A compliance officer seeing a monthly
//    export listed as active reasonably believes one is being produced and
//    delivered.
//
// Run from the repo root: node e2e/proofs/test-report-schedules-ux.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const raw = readFileSync(new URL('frontend-next/src/app/admin/reports/page.tsx', root), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\{\/\*).*$/gm, '')

// ── 1. Run state reaches the row ─────────────────────────────────────────
t('the schedule row type carries the runner\'s own record',
  /lastRunAt: string \| null; nextRunAt: string \| null/.test(src))
t('the loader maps last_run_at and next_run_at',
  /lastRunAt: r\.last_run_at \?\? null, nextRunAt: r\.next_run_at \?\? null/.test(src),
  'both were declared on ReportScheduleRow and dropped while mapping')

// ── 2. and is rendered, including the case that matters most ─────────────
t('the table has a Last Run / Next Run column',
  /'Last Run \/ Next Run'/.test(src))
t('a schedule that has never run says so explicitly',
  /Never run/.test(src),
  'a blank cell reads as "no data yet", not as "this never fired"')
t('the next run is shown, and a disabled schedule says it will not run',
  /disabled — will not run/.test(src) && /next \$\{fmtDateTime\(s\.nextRunAt\)\}/.test(src))
t('run state survives an edit instead of being reset',
  /lastRunAt: existing\?\.lastRunAt \?\? null/.test(src),
  'editing the recipients must not make a running schedule look new')
t('the empty-state colspan matches the widened row',
  /colSpan=\{9\}/.test(src) && !/colSpan=\{8\}/.test(src))

// ── 3. A failed fetch shows nothing, not fixtures ────────────────────────
t('a failed schedule fetch clears the list',
  /if \(!rows\) \{ setSchedules\(\[\]\); return \}/.test(src),
  'returning early left the seeded demo rows presented as live crons')
t('the old early-return on a null response is gone',
  !/if \(cancelled \|\| !rows\) return/.test(src))

// ── 4. The seeds themselves are only a demo-mode fallback ────────────────
// They may exist for the offline/demo path, but nothing in them should ever be
// mistaken for this org's configuration once live.
{
  const orgData = readFileSync(new URL('frontend-next/src/lib/orgData.ts', root), 'utf8')
  const seeded = /Monthly Compliance Export/.test(orgData)
  t('the demo seeds still exist for demo mode', seeded,
    'this proof is about not showing them in LIVE mode, not about deleting them')
}

// ── 5. The backend really does maintain what the UI now shows ────────────
// Rendering last_run_at is only honest if something writes it.
{
  const flows = JSON.parse(readFileSync(new URL('backend/node-red/flows.nodered-backend.json', root), 'utf8'))
  const all = flows.filter((n) => typeof n.func === 'string').map((n) => n.func).join('\n')
  t('the runner selects due schedules by next_run_at',
    /FROM report_schedules WHERE enabled=1 AND \(next_run_at IS NULL OR next_run_at<=NOW\(3\)\)/.test(all))
  t('the runner stamps last_run_at and the following next_run_at',
    /UPDATE report_schedules SET last_run_at=NOW\(3\), next_run_at=\? WHERE id=\?/.test(all))
  t('a newly saved schedule becomes due immediately rather than never',
    /next_run_at\) VALUES \([^)]*NOW\(3\)\)/.test(all),
    'a NULL next_run_at with no NOW() default would sit unfired forever')
}

// ── 6. Preview covers every format the download will produce ─────────────
// The preview built its data with `format: selectedFormats[0]` and rendered one
// generic document, while the footer button read "Download Formal PDF & XLSX &
// CSV Report". Two of the three files were never shown, and they are not
// restylings of the first: exportIIoTCSV emits titled sections of rows and
// exportIIoTXLSX emits a multi-sheet workbook whose first sheet is a key/value
// cover page. An operator checking a report before sending it to an auditor was
// checking one document and shipping three.
{
  const gen = readFileSync(new URL('frontend-next/src/lib/iiotReportGenerator.ts', root), 'utf8')

  // The builders must be separable from the download, or the preview can only
  // ever be an impression of the file rather than the file.
  t('the CSV document can be built without downloading it',
    /export async function buildIIoTCsvSections\(/.test(gen))
  t('the XLSX workbook can be built without downloading it',
    /export async function buildIIoTXlsxSheets\(/.test(gen))
  t('the download path still goes through those same builders',
    /const \{ sections, meta \} = await buildIIoTCsvSections\(opts, data\)/.test(gen) &&
    /const sheets = await buildIIoTXlsxSheets\(opts, data\)/.test(gen),
    'a preview built by different code than the export is not a preview')

  t('the preview has a tab per selected format',
    /selectedFormats\.length > 1 && \(/.test(src) && /setPreviewFormat\(f\)/.test(src))
  t('the preview renders the real CSV sections',
    /buildIIoTCsvSections\(opts, reportData\)/.test(src))
  t('the preview renders the real XLSX sheets',
    /buildIIoTXlsxSheets\(opts, reportData\)/.test(src))
  t('the tab cannot point at a format that is not selected',
    /if \(!selectedFormats\.includes\(previewFormat\)\) setPreviewFormat/.test(src))
  t('the preview states that every selected format is produced on download',
    /all \{selectedFormats\.length\} files are produced on download/.test(src))
  t('a truncated preview says the file still contains every row',
    /the file contains all of them/.test(src) && /the sheet contains all of them/.test(src),
    'showing 8 rows without saying so reads as "this is the whole export"')
}

// ── 7. The preview does not claim a verification it has not performed ────
// At preview time no document exists, nothing has been hashed, and no check has
// run. "SHA-256 Verified" states that one was performed and passed.
t('the preview does not badge itself "SHA-256 Verified"',
  !/SHA-256 Verified/.test(src))
t('it says when the digest is actually computed instead',
  /SHA-256 on export/.test(src) && /stamped at export/.test(src))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
