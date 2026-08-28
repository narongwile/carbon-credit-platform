// Verifies the two behavioural fixes found by the frontend dead-code sweep.
//
// 1. admin/reports called useRouter() and never used the result, so ?siteId=
//    and &domain= worked in one direction only: you could arrive on a filtered
//    view, but changing the filter left the address bar describing the state
//    the page opened with — nothing to bookmark or send to a colleague, and a
//    refresh silently reverted the filter.
//
// 2. AlarmParamConfig implemented toggleAll() — including its success toast —
//    and never gave it a control, so "enable/disable every parameter" existed
//    in the code and was unreachable in an editor with up to 80 rows.
//
// Run from e2e/browser/ with mock-backend.mjs on :4001 and next dev on :3901.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

// Both pages are behind auth; seed a session the way the other browser tests
// in this directory do, or every assertion below just measures the login form.
await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  localStorage.setItem('oneops_token', 'faketoken')
  localStorage.setItem('eternity_user', JSON.stringify({
    id: 'u1', username: 'admin', email: 'admin', role: 'admin', orgId: 'org-1', name: 'admin',
  }))
})

// ── 1. admin/reports keeps the URL in sync ────────────────────────────────
await page.goto('http://localhost:3901/admin/reports/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)

const before = await page.evaluate(() => window.location.search)
t('reports opens with no filter query', before === '' || !before.includes('domain='), `search="${before}"`)

// The page writes ?domain= only when exactly ONE domain is selected. The
// chips render as "✓\nTransformers (ETERNITY)" etc., so match on the label
// text rather than anchoring at the start of the button.
await page.locator('button:has-text("Clear")').first().click()
await page.waitForTimeout(400)
await page.locator('button:has-text("Transformers (ETERNITY)")').first().click()
await page.waitForTimeout(1000)
const afterDomain = await page.evaluate(() => window.location.search)
t('changing the domain filter writes it into the URL',
  afterDomain.includes('domain='),
  `search="${afterDomain}" (was "${before}")`)

// The URL must survive a reload as the same filtered view.
if (afterDomain.includes('domain=')) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const afterReload = await page.evaluate(() => window.location.search)
  t('the filtered URL still describes the same view after a reload',
    afterReload.includes('domain='), `search="${afterReload}"`)
}

// ── 2. AlarmParamConfig exposes enable-all / disable-all ──────────────────
await page.goto('http://localhost:3901/transformers/detail/?id=tr-001', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)

// Open the admin threshold editor (My Alert Settings → device-wide accordion).
const accordion = page.locator('button:has-text("Device-Wide Alarm Thresholds")')
if (await accordion.count()) {
  await accordion.first().click()
  await page.waitForTimeout(1500)
}

const enableAll = page.locator('button:has-text("Enable all")')
const disableAll = page.locator('button:has-text("Disable all")')
t('AlarmParamConfig exposes an "Enable all" control', await enableAll.count() > 0)
t('AlarmParamConfig exposes a "Disable all" control', await disableAll.count() > 0)

// Clicking it must actually change the checkboxes, not just fire a toast.
if (await disableAll.count()) {
  const checkedBefore = await page.evaluate(() =>
    [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).length)
  await disableAll.first().click()
  await page.waitForTimeout(900)
  const checkedAfter = await page.evaluate(() =>
    [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).length)
  t('"Disable all" actually clears the parameter checkboxes',
    checkedAfter < checkedBefore || checkedBefore === 0,
    `checked ${checkedBefore} -> ${checkedAfter}`)

  await enableAll.first().click()
  await page.waitForTimeout(900)
  const checkedReenabled = await page.evaluate(() =>
    [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).length)
  t('"Enable all" re-arms them', checkedReenabled > checkedAfter,
    `checked ${checkedAfter} -> ${checkedReenabled}`)
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
