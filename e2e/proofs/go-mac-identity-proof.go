//go:build ignore

// Proves the MAC-suffix relaxation in handleTelemetry's identity check cannot
// be used by one device to publish as another.
//
// WHY THIS MATTERS
// ----------------
// The EMQX ACL pins device publishes to "telemetry/+/+/${clientid}", so the
// TOPIC id is broker-authorised. The PAYLOAD id is just a field in the frame.
// The worker's identity check is what stops a device writing into an asset
// that is not its own, and the org (tenant) is resolved FROM the id that
// survives that check — so a bad rewrite here is a cross-tenant write.
//
// Support for "tr-221_246F28A1B2C3" publishing as "tr-221" relaxed that check.
// As first written it accepted two shapes:
//
//	(a) topic suffixed, payload bare      — the intended case
//	(b) topic "X_MAC1", payload "X_MAC2"  — BOTH suffixed, same base
//
// (b) let one provisioned device publish under a different provisioned
// device's id. It is also self-contradictory: the same change added a
// slew-rate guard whose whole purpose is to DETECT two devices colliding on
// one nodeId, while (b) makes that collision legal at the door.
//
// (a) is still only safe when the suffixed topic id is not itself a registered
// asset — otherwise a real device in org A can write into the separate asset
// "tr-221" in org B.
//
// Run from the repo root: go run e2e/proofs/go-mac-identity-proof.go

package main

import (
	"fmt"
	"os"
	"strings"
)

var pass, fail int

func t(name string, ok bool, detail string) {
	if ok {
		fmt.Printf("PASS %s\n", name)
		pass++
	} else {
		fmt.Printf("FAIL %s  %s\n", name, detail)
		fail++
	}
}

// ── verbatim from worker/main.go ────────────────────────────────────────────
func stripMacSuffix(id string) (string, string) {
	if idx := strings.LastIndex(id, "_"); idx > 0 {
		suffix := id[idx+1:]
		if len(suffix) == 12 {
			isHex := true
			for _, c := range suffix {
				if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
					isHex = false
					break
				}
			}
			if isHex {
				return id[:idx], strings.ToUpper(suffix)
			}
		}
	}
	return id, ""
}

// registry stands in for nodeInfo(): a node id present here is REGISTERED and
// returns a non-empty org.
type registry map[string]string

// resolveIdentity mirrors the guarded branch in handleTelemetry.
// Returns the id the frame is recorded under, and whether it was rejected.
func resolveIdentity(topicID, payloadID string, reg registry) (string, bool) {
	claimed := topicID
	if claimed == "" || claimed == payloadID {
		return payloadID, false
	}
	baseClaimed, _ := stripMacSuffix(claimed)
	// Guard 1: topic-suffixed / payload-bare only (no sibling case).
	if baseClaimed != "" && baseClaimed == payloadID {
		// Guard 2: the suffixed topic id must not itself be registered.
		if org := reg[claimed]; org != "" {
			return "", true // rejected
		}
		return payloadID, false
	}
	return "", true // rejected
}

func main() {
	// tr-221 belongs to org-1. tr-221_AABBCCDDEEFF is a SEPARATE registered
	// asset in org-2 — the cross-tenant setup.
	reg := registry{
		"tr-221":              "org-1",
		"tr-221_AABBCCDDEEFF": "org-2",
		"tr-999":              "org-1",
	}

	// ── the intended case still works ──────────────────────────────────────
	// An unregistered MAC-suffixed clientid publishing as its bare asset.
	got, rejected := resolveIdentity("tr-999_246F28A1B2C3", "tr-999", reg)
	t("intended: unregistered MAC-suffixed topic may publish as its bare asset",
		!rejected && got == "tr-999", fmt.Sprintf("got=%q rejected=%v", got, rejected))

	// ── guard 2: registered suffixed id may NOT write into another asset ───
	got, rejected = resolveIdentity("tr-221_AABBCCDDEEFF", "tr-221", reg)
	t("CROSS-TENANT: registered org-2 device may NOT publish as org-1's tr-221",
		rejected, fmt.Sprintf("got=%q — a real device wrote into another tenant's asset", got))

	// ── guard 1: sibling impersonation ────────────────────────────────────
	got, rejected = resolveIdentity("tr-221_AABBCCDDEEFF", "tr-221_112233445566", reg)
	t("SIBLING: device may NOT publish under another suffixed device's id",
		rejected, fmt.Sprintf("got=%q — one device impersonated another", got))

	// ── unrelated ids still rejected (the original guarantee) ─────────────
	got, rejected = resolveIdentity("tr-111", "tr-221", reg)
	t("unrelated ids still rejected", rejected, fmt.Sprintf("got=%q", got))

	// A suffix that is not 12 hex chars must not be treated as a MAC.
	got, rejected = resolveIdentity("tr-221_NOTAMACADDR", "tr-221", reg)
	t("non-hex suffix is not treated as a MAC", rejected, fmt.Sprintf("got=%q", got))

	got, rejected = resolveIdentity("tr-221_AABBCC", "tr-221", reg)
	t("short suffix is not treated as a MAC", rejected, fmt.Sprintf("got=%q", got))

	// Matching ids are always fine.
	got, rejected = resolveIdentity("tr-999", "tr-999", reg)
	t("matching topic and payload accepted", !rejected && got == "tr-999", fmt.Sprintf("got=%q", got))

	// ── stripMacSuffix itself ─────────────────────────────────────────────
	b, m := stripMacSuffix("tr-221_246f28a1b2c3")
	t("stripMacSuffix uppercases the MAC", b == "tr-221" && m == "246F28A1B2C3", fmt.Sprintf("base=%q mac=%q", b, m))
	b, _ = stripMacSuffix("tr-221")
	t("stripMacSuffix leaves a bare id alone", b == "tr-221", fmt.Sprintf("base=%q", b))
	b, _ = stripMacSuffix("_AABBCCDDEEFF")
	t("leading underscore is not a suffix split", b == "_AABBCCDDEEFF", fmt.Sprintf("base=%q", b))

	fmt.Printf("\n%d passed, %d failed\n", pass, fail)
	if fail > 0 {
		os.Exit(1)
	}
}
