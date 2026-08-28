// Drives the restructured PdM section in a real browser.
//
// The transformer page used to carry four inline PdM sub-tabs, three of which
// were periodic-review material (bushing tan-delta from an annual offline
// Doble test, arrester/OLTC inspection reference, BESS what-if) while the one
// panel with a live feed behind it — the dynamic rating — sat second of four
// with BESS buried another level down behind a toggle. The live monitoring
// surface was mostly things nobody watches.
//
// Now: two inline tabs (dissolved gas, live dynamic rating) and six studies
// behind an "Engineering Studies" launcher. This asserts the launcher opens
// each study, and that StudyModal's Escape / backdrop / scroll-lock behaviour
// — none of which the two hand-rolled dialogs it replaced had — actually works.
//
// Run from e2e/browser/ with mock-backend.mjs on :4001 and next dev on :3901.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'

const URL = 'http://localhost:3901/transformers/detail/?id=tr-001'
let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)

// The PdM section renders inline on load — no navigation needed. (Clicking a
// "Diagnostics" tab here actually navigates AWAY from it.)

// ── the launcher exists ───────────────────────────────────────────────────
const launcher = page.locator('text=Engineering Studies')
t('Engineering Studies launcher is present', await launcher.count() > 0)

// ── the four inline tabs are down to two ──────────────────────────────────
// Scoped to the tab bar: the launcher buttons carry the same labels, so an
// unscoped has-text() matches those and can never pass.
const tabLabels = await page.evaluate(() =>
  [...document.querySelectorAll('[data-pdm-tabs] button')]
    .map((b) => b.innerText.trim().split('\n')[0]))
t('inline PdM tabs are down to the two live panels',
  tabLabels.length === 2, `tabs = ${JSON.stringify(tabLabels)}`)
t('the dissolved-gas and dynamic-rating tabs are the ones kept',
  tabLabels.some((l) => /Duval/.test(l)) && tabLabels.some((l) => /Dynamic Rating/.test(l)),
  JSON.stringify(tabLabels))

// ── each study opens ──────────────────────────────────────────────────────
const STUDIES = [
  ['Insulation Aging & RUL', 'Remaining Life'],
  ['Bushing Health (tan δ)', 'Bushing Health'],
  ['5-Threats & OLTC', '5-Threats'],
  ['BESS Peak Shaving', 'BESS Peak Shaving'],
  ['Laboratory DGA', 'Laboratory DGA'],
  ['Fleet Risk Matrix', 'Fleet Risk Matrix'],
]

// Wait on the dialog's actual presence, never on a fixed delay: under the dev
// server a 700ms sleep intermittently landed before React had committed, which
// looked exactly like a broken close handler.
const openStudy = async (label) => {
  await page.locator(`button:has-text("${label}")`).first().click()
  await page.waitForSelector('[role="dialog"]', { state: 'attached', timeout: 8000 })
}
const waitClosed = () => page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 })

for (const [button, expectInTitle] of STUDIES) {
  const btn = page.locator(`button:has-text("${button}")`).first()
  if (!(await btn.count())) { t(`launcher has "${button}"`, false, 'button not found'); continue }

  let title = ''
  try {
    await openStudy(button)
    title = (await page.locator('[role="dialog"]').getAttribute('aria-label')) || ''
  } catch { /* assertion below reports it */ }
  t(`"${button}" opens a dialog titled for it`,
    title.includes(expectInTitle), title ? `aria-label=${title}` : 'no [role=dialog] appeared')

  // Escape must close it — the hand-rolled dialogs ignored the keyboard.
  await page.keyboard.press('Escape')
  const closed = await waitClosed().then(() => true).catch(() => false)
  t(`"${button}" closes on Escape`, closed)
}

// ── scroll lock + backdrop close ──────────────────────────────────────────
await openStudy('Fleet Risk Matrix')
const lockedOverflow = await page.evaluate(() => document.body.style.overflow)
t('body scroll is locked while a study is open', lockedOverflow === 'hidden', `overflow=${lockedOverflow}`)

// Clicking inside must NOT close (the stopPropagation guard). Target the
// dialog's own heading rather than an arbitrary coordinate: (200,200) inside
// the panel can land on whatever control the study happens to render there,
// which makes this assertion measure that control instead of the guard.
await page.locator('[role="dialog"] h3').first().click().catch(() => {})
await page.waitForTimeout(400)
t('clicking inside the panel does not close it', await page.locator('[role="dialog"]').count() > 0)

// Clicking the backdrop must close.
await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const backdrop = dlg && dlg.parentElement
  if (backdrop) backdrop.click()
})
const backdropClosed = await waitClosed().then(() => true).catch(() => false)
t('clicking the backdrop closes the study', backdropClosed)

const restoredOverflow = await page.evaluate(() => document.body.style.overflow)
t('body scroll is restored after closing', restoredOverflow !== 'hidden', `overflow=${restoredOverflow}`)

// The 3D twin's HDR env-map fetch and Next's dev-mode hydration warning fire
// on load regardless of this change, so assert on errors this work could
// cause rather than pretending the page is error-free.
const relevant = errors.filter((e) => !/hydrat|potsdamer_platz|Suspense/i.test(e))
t('no uncaught page errors from the studies', relevant.length === 0, relevant.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
