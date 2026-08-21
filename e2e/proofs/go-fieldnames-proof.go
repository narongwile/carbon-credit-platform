package main

// worker/main.go's paramMap/canonicalParam and the dropNullValues null-guard,
// extracted verbatim — confirms the Go worker (the real production hot path)
// agrees with the Node-RED normalize node proved in
// test-real-device-fieldnames.mjs, and that a JSON null in a values object
// (e.g. THD_VoltBC: null, seen on a real payload) is dropped instead of
// silently stored as a fabricated 0.0 — encoding/json's default behaviour for
// null into map[string]float64.
//
// Run: go run e2e/proofs/go-fieldnames-proof.go

import (
	"encoding/json"
	"fmt"
)

// --- verbatim from worker/main.go ---
var paramMap = map[string]string{
	"oil_temp_c":           "oilTemp",
	"Oiltemp":              "oilTemp",
	"ambient_temp_c":       "ambientTemp",
	"Tamb":                 "ambientTemp",
	"winding_temp_c":       "windingTemp",
	"dga_h2_ppm":           "hydrogen",
	"hydrogen_ppm":         "hydrogen",
	"H2":                   "hydrogen",
	"moisture_ppm":         "moisture",
	"OilMoisture":          "moisture",
	"oil_level_pct":        "oilLevel",
	"load_pct":             "load",
	"door_state":           "door",
	"electrical_current_a": "current",
	"current_a":            "current",
	"rh_pct":               "rh",
	"batt_pct":             "battery",
	"impact_g":             "impact",
	"baro_alt_m":           "baroAlt",
}

func canonicalParam(key string) string {
	if c, ok := paramMap[key]; ok {
		return c
	}
	return key
}

func dropNullValues(payload []byte, values map[string]float64) {
	if len(values) == 0 {
		return
	}
	var probe struct {
		Values map[string]json.RawMessage `json:"values"`
	}
	if err := json.Unmarshal(payload, &probe); err != nil {
		return
	}
	for k, raw := range probe.Values {
		if string(raw) == "null" {
			delete(values, k)
		}
	}
}

// --- test harness ---
func main() {
	pass, fail := 0, 0
	check := func(name string, ok bool, detail string) {
		v := "FAIL"
		if ok {
			v = "PASS"
		}
		fmt.Printf("%s %s  %s\n", v, name, detail)
		if ok {
			pass++
		} else {
			fail++
		}
	}

	check("Oiltemp -> oilTemp", canonicalParam("Oiltemp") == "oilTemp", "")
	check("H2 -> hydrogen", canonicalParam("H2") == "hydrogen", "")
	check("OilMoisture -> moisture", canonicalParam("OilMoisture") == "moisture", "")
	check("Tamb -> ambientTemp", canonicalParam("Tamb") == "ambientTemp", "")
	check("Tbox passes through unmapped", canonicalParam("Tbox") == "Tbox", "")
	check("RHamb passes through unmapped", canonicalParam("RHamb") == "RHamb", "")
	check("RHbox passes through unmapped", canonicalParam("RHbox") == "RHbox", "")
	check("an already-canonical key is unaffected", canonicalParam("VoltAN") == "VoltAN", "")

	// Real payload shape: a null THD reading alongside real values.
	payload := []byte(`{"nodeId":"TR-1","values":{"THD_VoltBC":null,"VoltAN":225.5,"Oiltemp":62.4}}`)
	values := map[string]float64{"THD_VoltBC": 0, "VoltAN": 225.5, "Oiltemp": 62.4} // what json.Unmarshal produces before the guard
	dropNullValues(payload, values)
	_, stillThere := values["THD_VoltBC"]
	check("a null reading is dropped, not stored as a fabricated 0", !stillThere, fmt.Sprintf("values=%v", values))
	check("real sibling values in the same frame are untouched", values["VoltAN"] == 225.5 && values["Oiltemp"] == 62.4, "")

	fmt.Printf("\n%d passed, %d failed\n", pass, fail)
	if fail > 0 {
		panic("field-name proof failed")
	}
}
