# e2e — real verification, not just code review

Every fix and feature this directory covers was verified against a real
running app (mock backend + `next dev`) or a real extracted function body —
never trusted on inspection alone. These scripts are that verification,
saved so it survives past one session instead of living only in a shell
history that disappears on restart.

**This is not wired into CI yet.** `.gitlab-ci.yml` currently runs `npm run
build` and a Node-RED syntax gate, nothing else — no `tsc --noEmit`, no
`eslint`, and none of what's in here. A bot commit (or any commit) can
reintroduce any bug these scripts catch and nothing will flag it before
deploy. Wiring a job that runs `npm run build && npx tsc --noEmit && npx
eslint src` plus the two directories below is the natural next step, not
yet done.

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
node test-xss-map-popup.mjs          # stored-XSS regression: hostile device id in the map popup
```

Each script prints `PASS`/`FAIL` lines and exits non-zero on any failure —
safe to pipe into a CI job once one exists. `mock-backend.mjs` is the
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
go run e2e/proofs/go-alarm-state-proof.go  # the exact state machine from worker/main.go's evaluateAlarms,
                                            #   extracted verbatim: proves two alarm bands sharing one telemetry
                                            #   key (e.g. over/under-voltage on the same phase) track independent
                                            #   state instead of one clobbering the other into a duplicate-alarm loop
```

`test-emailguard.mjs` and `test-riskmap.mjs` read
`backend/node-red/flows.nodered-backend.json` directly — run `node
backend/node-red/generate-nodered-backend.mjs` first if the generator
source has changed since the committed flow was last built, or they'll be
proving yesterday's behavior.

## Known gaps these do NOT cover

Surfaced during an industrial-alarm-practices review and not yet built:
alarm priority (distinct from severity), an audit trail on threshold
changes, alarm-flood/notification-storm protection at the dispatch layer,
standing/stale-alarm tracking, and alarm shelving. None of that has test
coverage here because none of it exists yet.
