# e2e — real verification, not just code review

Every fix and feature this directory covers was verified against a real
running app (mock backend + `next dev`) or a real extracted function body —
never trusted on inspection alone. These scripts are that verification,
saved so it survives past one session instead of living only in a shell
history that disappears on restart.

**`proofs/` is wired into CI; `browser/` is not.** `.gitlab-ci.yml` has a
`test` stage that runs every script in `proofs/` — the Node-RED generator and
its syntax gate, all nine Node proofs, and the three Go proofs — plus `npm run
lint` and `npx tsc --noEmit`. A commit that reintroduces any bug those catch
now fails the pipeline before it can deploy.

The `browser/` suites still are not: they need a Chromium, a `next dev` and
the mock backend running together, which the current runners are not set up
for. Until that exists, the browser scripts are run by hand — and note that
all but three of them do not exit non-zero on failure (see below), so they
cannot simply be dropped into a job as they stand.

## `browser/` — Playwright suites against a mock backend

Every script here drives a real Chromium instance against `next dev` on
`:3901`, talking to `mock-backend.mjs` on `:4001` instead of the real
cluster (in-memory state, seeded fleet/charts/rules — real HTTP and
WebSocket wire format, no live infra needed).

```bash
# from the repo root, two terminals (or background both):
node e2e/browser/mock-backend.mjs &
cd frontend-next && NEXT_PUBLIC_API_URL=http://localhost:4001 \
  NEXT_PUBLIC_WS_URL=ws://localhost:4001/ws/telemetry npx next dev -p 3901 &

# then, from e2e/browser/ — NOT the repo root. Every script writes its
# screenshot to a relative ./screenshots/, which resolves against whatever
# directory the `node` process was started FROM, not the script's own
# location — run from the repo root and the very first suite will happily
# create a stray screenshots/ at the repo root instead.
cd e2e/browser
node test-chart-analysis-modal.mjs   # Chart Analysis modal, admin + viewer — 66 assertions
node test-mobile-responsive.mjs      # same feature at 360x640 / 393x852 — 30 assertions
node test-dual-band-voltage.mjs      # over/under-voltage sharing one key, independent state
node test-studio-features.mjs        # brush, chart/table toggle, thresholds on-off, refresh, Δ Span
node test-xss-map-popup.mjs          # stored-XSS regression: hostile device id in the map popup
                                     #   ⚠️ CURRENTLY CANNOT RUN — see "Known gaps" below
node test-iiot-ux-upgrades.mjs       # the 5 features named in the "industrial iiot UX upgrades" commit really
                                     #   work in a real browser: jump-to-peak zoom, chart snapshot, inline
                                     #   alarm tuning, live-stream pause, drag-and-drop dashboard cards.
                                     #   Also asserts the tuning dialog's threshold-provenance badge (added in
                                     #   4d9f29d3) is shown — a saved rule, a catalog standard, an
                                     #   unrationalized catalog entry, or a disclosed statistical guess
node test-alarm-discovery-ui.mjs     # each reading sensor gets ONE row in the alarm editor carrying its
                                     #   engineered limits — no duplicate phantom row on a guessed limit,
                                     #   and a discovered key with no catalog entry is offered switched OFF
node test-pdf-readability.mjs        # downloads the real report PDF and asserts on its content stream:
                                     #   no white-on-white text, the dark heading colour is used, and the
                                     #   footer disclaimer is not clipped off the right edge
node test-reports-copy.mjs           # the reports page advertises only analyses the engine can
                                     #   actually back — no Duval triangle, no thermal aging factor,
                                     #   no IEEE 519/C57.104/60076/21 CFR conformance badges
```

Each script prints `PASS`/`FAIL` lines, but **only `test-studio-features.mjs`,
`test-reports-copy.mjs`, `test-alarm-discovery-ui.mjs` and
`test-pdf-readability.mjs` actually exit non-zero on failure** — the other 30
count nothing and always exit 0. This paragraph used to claim they were all
"safe to pipe into a CI job"; they are not. Piping the rest into CI today
buys a job that goes green while assertions fail underneath it. Adding a
pass/fail counter and `process.exit(fail ? 1 : 0)` to each is a prerequisite
for the CI work described at the top of this file, not a follow-up to it.

`mock-backend.mjs` is the
shared dependency every other script in this folder assumes is already
running on `:4001`; it needs a fresh restart between runs of scripts that
mutate its in-memory state (creating a chart, moving a device, etc.) or
state from one run bleeds into the next.

Screenshots go to `browser/screenshots/` (gitignored) — most scripts save
one for visual sanity-checking, not asserted on.

Chromium path is pinned to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
in every script (the environment this suite was built in). On a different
machine, swap `executablePath` for a plain `chromium.launch({ headless:
true })` and let Playwright resolve its own install.

## `proofs/` — standalone verification, no browser

These don't need a browser or the mock backend. Each either drives a REAL
function body extracted out of the built artifact (not a hand-copied
approximation that can drift from what's actually deployed), or checks pure
logic against known-correct answers.

```bash
# from the repo root:
node e2e/proofs/verify-pearson.mjs         # the correlation math in ChartAnalysisModal, against textbook answers
node e2e/proofs/test-emailguard.mjs        # extracts the REAL generated email-template/test handler, proves the
                                            #   recipient guard (self or same-org only) — regenerate the flow first
                                            #   if backend/node-red/generate-nodered-backend.mjs changed
node e2e/proofs/test-riskmap.mjs           # extracts the REAL generated notify handler, proves alarm keys resolve
                                            #   real risk text instead of the generic fallback
node e2e/proofs/test-report-honesty.mjs    # greps the IIoT report generator + both reports pages (comments
                                            #   stripped first) for every fabricated constant/fallback this session
                                            #   found and removed — fails if any of them come back
node e2e/proofs/test-rate-of-rise.mjs      # rate-of-rise measured as change per unit time in the rule's own
                                            #   unit (ppm/day, °C/h), driven through the REAL generated Node-RED
                                            #   evaluate() — not a raw sample-to-sample delta
go run e2e/proofs/go-rate-of-rise-proof.go # the same semantics in worker/main.go, confirming both engines agree
go run e2e/proofs/go-alarm-state-proof.go  # the exact state machine from worker/main.go's evaluateAlarms,
                                            #   extracted verbatim: proves two alarm bands sharing one telemetry
                                            #   key (e.g. over/under-voltage on the same phase) track independent
                                            #   state instead of one clobbering the other into a duplicate-alarm loop
node e2e/proofs/test-edge-alarm-surfaces.mjs     # a firmware-raised alarm (the Alarm List's External Fault/
                                            #   Event) reaches alarm_events and the notifier instead of
                                            #   dead-ending in edge_alarm_log, and does not re-notify while
                                            #   the same alarm is already open
node e2e/proofs/audit-catalog-vs-device.mjs      # every parameter the REAL fleet publishes (captured frames in
                                            #   e2e/fixtures/real-device-payloads.json) is addressable by some
                                            #   alarm rule, and no auto-armed alarm names a key nothing sends.
                                            #   Prints a full reachability report; exits non-zero on either bug
node e2e/proofs/test-alarm-param-discovery.mjs   # the alarm editor's catalog-vs-discovery resolution: bare wire
                                            #   keys matched against a rowId-keyed (key::direction) catalog,
                                            #   so a published sensor is never listed twice
node e2e/proofs/test-real-device-fieldnames.mjs  # the REAL ETERNITY transformer's actual wire spellings
                                            #   (Oiltemp/H2/OilMoisture/Tamb, confirmed against a live MQTT
                                            #   payload) normalize to their canonical param keys through the
                                            #   real generated Node-RED 'normalize' node — Tbox/RHamb/RHbox are
                                            #   proved to pass through unmapped, not guessed at
go run e2e/proofs/go-fieldnames-proof.go   # the same mapping in worker/main.go's paramMap, plus: a JSON null
                                            #   in a values object (seen for real as THD_VoltBC: null) is
                                            #   dropped instead of silently stored as a fabricated 0.0
```

`test-emailguard.mjs` and `test-riskmap.mjs` read
`backend/node-red/flows.nodered-backend.json` directly — run `node
backend/node-red/generate-nodered-backend.mjs` first if the generator
source has changed since the committed flow was last built, or they'll be
proving yesterday's behavior.

## `test-xss-map-popup.mjs` cannot currently run

It looks for a fleet device named "Evil Device" whose id is
`TR-X" onmouseover=alert(1) x="`, and asserts the map popup escapes it.
`mock-backend.mjs` has never contained that device — `git log --all -S` finds
the string only in the test file itself — so the fixture the test needs has
never existed, and the test has failed since the day it was committed.

Two of its six checks still print PASS ("no onmouseover attribute was
injected", "hovering executed no script"). Those pass **vacuously**: with no
hostile input on the page there is nothing to inject. They are not evidence.

The escaping fix itself is real and unaffected — `esc()` in
`components/map/LiveSensorMap.tsx` escapes `& < > " '` and is applied at every
popup interpolation point. What is missing is the fixture that would prove it.
Seeding that device into `mock-backend.mjs` is the fix.

## Known gaps these do NOT cover

Surfaced during an industrial-alarm-practices review and not yet built:
alarm priority (distinct from severity), an audit trail on threshold
changes, alarm-flood/notification-storm protection at the dispatch layer,
standing/stale-alarm tracking, and alarm shelving. None of that has test
coverage here because none of it exists yet.
