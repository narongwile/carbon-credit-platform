// The LIVE READING column must show each device its own number, and say so
// when it has none.
//
// WHAT WAS REPORTED
// -----------------
// On the Device-Wide Alarm Thresholds panel with tr-221 and tr-222 both
// selected, the column read as though one device's value was being shown for
// every device — Top Oil Temperature 38.5 °C against both, Ambient Temperature
// 46.3 °C CRIT against both.
//
// WHAT WAS ACTUALLY WRONG
// -----------------------
// The value resolution was already per-device and 54201657 is in the deployed
// image, so this is not one transformer's reading printed beside another's
// name. Three other things made the column impossible to read correctly:
//
// 1. A selected device that reports nothing was DROPPED from the list. With
//    two devices selected and one badge rendered, "tr-222 does not publish this
//    sensor" looked exactly like "tr-222 was not selected" — so a row showing a
//    single value gave no way to tell whether the other device had been
//    consulted at all. That is what makes the column read as one device's data
//    standing in for everything.
//
// 2. A value taken from device_presence.last_sample — the last payload a device
//    ever sent, which for an offline unit can be days old — rendered
//    identically to one polled seconds ago. The panel lists OFFLINE devices as
//    selectable (trxx81 in the report), so a stale number could sit beside a
//    live one with nothing to separate them.
//
// 3. Nothing structurally prevented the merged cross-device map from being used
//    on the multi-device path. liveReadings is built by taking the FIRST
//    device's value for each key, so if it ever reached the multi path it would
//    genuinely print one device's reading against every name — the failure that
//    was reported.
//
// Run from the repo root: node e2e/proofs/test-live-reading-per-device.mjs

import { readFileSync } from 'fs'

let pass = 0, fail = 0
const t = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++ }

const root = new URL('../../', import.meta.url)
const raw = readFileSync(new URL('frontend-next/src/components/device/AlarmParamConfig.tsx', root), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\{\/\*).*$/gm, '')

// ── 1. A device's value comes only from that device ──────────────────────
t('each device is read from its own keyed map',
  /getRawParamValue\(deviceReadingsMap\[id\], paramKey\)/.test(src))
t('the fallback is that device\'s own last_sample',
  /getRawParamValue\(\(dev as any\)\?\.lastSample, paramKey\)/.test(src))

// liveReadings merges across devices (first value per key wins), so it must
// never be consulted while more than one device is in scope.
t('the merged cross-device map is confined to the single-device path',
  /if \(nodeId\) \{[\s\S]{0,900}?getRawParamValue\(liveReadings, paramKey\)/.test(src) &&
  !/scopedDevices\.map\([\s\S]{0,400}?liveReadings/.test(src),
  'liveReadings takes the first device\'s value for each key — in the multi path that IS the reported bug')

// ── 2. Every selected device is accounted for ────────────────────────────
t('a device with no reading is returned, not silently dropped',
  /value: null, source: 'none'/.test(src) &&
  /return scopedDevices\.map\(\(dev\) => read\(dev, dev\.id\)\)/.test(src),
  'dropping it makes "does not report this" indistinguishable from "not selected"')
t('the cell names the devices that reported nothing',
  /no data: \{silent\.map\(\(d\) => d\.deviceName\)\.join\(', '\)\}/.test(src))
t('the empty cell says how many devices were silent',
  /None of the \$\{silent\.length\} selected devices report this parameter/.test(src))

// ── 3. Stale is visibly distinct from live ───────────────────────────────
t('readings carry their provenance',
  /source: 'live' \| 'last-known' \| 'none'/.test(src))
t('a last_sample value is marked as not current',
  /last known/.test(src) && /staleMark/.test(src),
  'device_presence.last_sample can predate the device going offline')
t('the stale marker is applied on the single and stacked layouts',
  (src.match(/\{staleMark\(dr\)\}/g) || []).length >= 2)
t('freshness is recorded per device, not globally',
  /const \[deviceReadingAt, setDeviceReadingAt\] = useState<Record<string, number>>/.test(src))
t('every ingest path stamps freshness',
  (src.match(/setDeviceReadingAt\(/g) || []).length >= 5,
  'poll and websocket, single-device and multi-device, plus the reset')

// ── 4. The silent-device note reaches all three layouts ──────────────────
t('the silent note is rendered in every branch',
  (src.match(/\{silentNote\}/g) || []).length >= 3,
  'single reading, 2-3 stacked badges, and the >3 range summary')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
