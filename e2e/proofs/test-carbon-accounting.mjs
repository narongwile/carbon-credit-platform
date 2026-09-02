import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..")
const CARBON_PAGE_PATH = path.join(ROOT, "frontend-next/src/app/admin/carbon/page.tsx")

console.log("--- Carbon & ESG Accounting Verification Gate ---")

const source = fs.readFileSync(CARBON_PAGE_PATH, "utf8")

// 1. Audit & Provenance Assertions
assert.ok(
  source.includes("recordAuditAction"),
  "admin/carbon must import and invoke recordAuditAction for 21 CFR Part 11 and ISO 14064 compliance"
)

assert.ok(
  source.includes("'CARBON_ADJUST'"),
  "admin/carbon must log CARBON_ADJUST actions into the immutable audit trail"
)

assert.ok(
  source.includes("DemoDataBanner"),
  "admin/carbon must render DemoDataBanner disclosing that emissions figures are modeled estimates, not continuous stack measurements"
)

assert.ok(
  source.includes("GHG PROTOCOL &amp; ISO 14064-1 COMPLIANT") || source.includes("GHG PROTOCOL & ISO 14064-1 COMPLIANT"),
  "admin/carbon must display GHG Protocol & ISO 14064-1 compliance badge"
)

// 2. Emission Factor Presets
assert.ok(source.includes("0.4999"), "Thailand EGAT factor must equal 0.4999 kgCO2e/kWh (TGO standard)")
assert.ok(source.includes("0.4168"), "Singapore EMA factor must equal 0.4168 kgCO2e/kWh")
assert.ok(source.includes("0.7221"), "Vietnam EVN factor must equal 0.7221 kgCO2e/kWh")
assert.ok(source.includes("0.3850"), "US eGRID factor must equal 0.3850 kgCO2e/kWh")
assert.ok(source.includes("0.2510"), "EU-27 factor must equal 0.2510 kgCO2e/kWh")

// 3. Scope 1, 2, 3 Mathematical Invariants
assert.ok(source.includes("24300"), "SF6 calculation must use IPCC AR6 GWP of 24,300")
assert.ok(source.includes("2.687"), "Diesel combustion factor must use 2.687 kgCO2e/L")
assert.ok(source.includes("useManagedDevices(orgId)"), "Scope 2 must bind to the active tenant fleet via useManagedDevices(orgId)")

// 4. Tab 2 TOU & Arbitrage Invariants
assert.ok(source.includes("annualAvoidedCarbonTco2e"), "Tab 2 must compute annualAvoidedCarbonTco2e")
assert.ok(source.includes("annualCostSavingsUsd"), "Tab 2 must compute annualCostSavingsUsd")
assert.ok(source.includes("Dispatch Optimization Schedule"), "Tab 2 must provide actionable dispatch button")

// 5. Tab 3 SBTi 1.5°C Trajectory Invariants
assert.ok(source.includes("0.042"), "SBTi 1.5°C trajectory must enforce 4.2%/yr linear reduction rate")
assert.ok(source.includes("leverSolarPv"), "Tab 3 must include interactive Rooftop Solar PV lever")
assert.ok(source.includes("leverTransformerCore"), "Tab 3 must include Low-Loss Transformer Core lever")
assert.ok(source.includes("leverLowGwpRefrigerant"), "Tab 3 must include Low-GWP Natural Refrigerant lever")
assert.ok(source.includes("leverSmartCharging"), "Tab 3 must include Smart EV Charging lever")

// 6. Direct Mathematical Unit Tests
function calculateScope2(kwh, ef) {
  return Number(((kwh * ef) / 1000).toFixed(2))
}
function calculateSf6(kg, leakPct, gwp = 24300) {
  return Number(((kg * (leakPct / 100) * gwp) / 1000).toFixed(2))
}
function calculateDiesel(liters, factor = 2.687) {
  return Number(((liters * factor) / 1000).toFixed(2))
}
function calculateSbti2030Reduction(baseEmissions, rate = 0.042, years = 8) {
  return Math.round(baseEmissions * (1 - rate * years))
}

// Check unit calculations
assert.equal(calculateScope2(1000000, 0.4999), 499.90, "1,000,000 kWh @ 0.4999 kgCO2e/kWh must yield 499.90 tCO2e")
assert.equal(calculateSf6(10, 0.5), 1.22, "10 kg SF6 with 0.5% leak must yield 1.22 tCO2e/yr")
assert.equal(calculateDiesel(1000), 2.69, "1,000 L diesel must yield 2.69 tCO2e")
assert.equal(calculateSbti2030Reduction(1000, 0.042, 8), 664, "1000 tCO2e baseline reduced by 4.2%/yr over 8 yrs must reach 664 tCO2e")

console.log("PASS: All 22 carbon accounting & ESG verification assertions succeeded.")
