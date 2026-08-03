package main

import (
	"database/sql"
	"os"
	"testing"
	"time"
)

// Real MySQL, gated behind PRESENCE_TEST_DSN so `go test ./...` in an
// environment without a database (e.g. CI without a MySQL service) still
// passes. Proves the merged-pair presence fix in updatePresence: an LWT
// arriving while last_reading_at is fresh must not flip a shared row offline,
// and a genuinely silent device must still be caught exactly as before.
func openPresenceTestDB(t *testing.T) *sql.DB {
	dsn := os.Getenv("PRESENCE_TEST_DSN")
	if dsn == "" {
		t.Skip("PRESENCE_TEST_DSN not set — skipping (needs a real MySQL instance)")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	stmts := []string{
		`DROP TABLE IF EXISTS alarm_events, transport_events, device_presence, nodes`,
		`CREATE TABLE nodes (id VARCHAR(64) PRIMARY KEY, org_id VARCHAR(64) NOT NULL, department_id VARCHAR(64))`,
		`CREATE TABLE device_presence (node_id VARCHAR(64) PRIMARY KEY, online TINYINT(1) DEFAULT 1,
			last_seen DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), last_reading_at DATETIME(3) NULL,
			rssi SMALLINT, batt TINYINT, fw VARCHAR(32))`,
		`CREATE TABLE alarm_events (id VARCHAR(160) PRIMARY KEY, node_id VARCHAR(64), org_id VARCHAR(64),
			department_id VARCHAR(64), param_key VARCHAR(40), param_label VARCHAR(80),
			severity VARCHAR(16), kind VARCHAR(16), value DECIMAL(12,3), threshold DECIMAL(12,3),
			unit VARCHAR(16), raised_at DATETIME(3), cleared_at DATETIME(3) NULL)`,
		`CREATE TABLE transport_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, node_id VARCHAR(64),
			from_transport VARCHAR(8), to_transport VARCHAR(8), reason VARCHAR(120), rssi SMALLINT,
			ts DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3))`,
		`INSERT INTO nodes (id, org_id, department_id) VALUES ('tr-222', 'org-1', NULL)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("setup %q: %v", s, err)
		}
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func countRows(t *testing.T, db *sql.DB, q string, args ...interface{}) int {
	t.Helper()
	var n int
	if err := db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", q, err)
	}
	return n
}

func TestMergedPairIgnoresLWTWhileReadingsAreFresh(t *testing.T) {
	db := openPresenceTestDB(t)
	origControl, origTenant := controlDB, tenantMode
	controlDB, tenantMode = db, false
	t.Cleanup(func() { controlDB, tenantMode = origControl, origTenant })

	// tr-222 is online with a reading stored 3s ago — as if tr-221 (its merged
	// partner) is still actively reporting. tr-221's radio then sends its LWT,
	// which resolveFeed has already redirected onto tr-222's shared row.
	_, err := db.Exec(
		`INSERT INTO device_presence (node_id, online, last_seen, last_reading_at) VALUES ('tr-222', 1, NOW(3), ?)`,
		time.Now().Add(-3*time.Second))
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	updatePresence(TelemetryPayload{NodeID: "tr-222", State: "offline"})

	var online int
	if err := db.QueryRow("SELECT online FROM device_presence WHERE node_id='tr-222'").Scan(&online); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if online != 1 {
		t.Fatalf("online = %d, want 1 (LWT should have been outvoted by fresh last_reading_at)", online)
	}
	if n := countRows(t, db, "SELECT COUNT(*) FROM transport_events WHERE node_id='tr-222'"); n != 0 {
		t.Fatalf("transport_events rows = %d, want 0 (no spurious LINK_LOST)", n)
	}
	if n := countRows(t, db, "SELECT COUNT(*) FROM alarm_events WHERE node_id='tr-222'"); n != 0 {
		t.Fatalf("alarm_events rows = %d, want 0 (no spurious Device Offline alarm)", n)
	}
}

func TestGenuinelySilentDeviceStillGoesOffline(t *testing.T) {
	db := openPresenceTestDB(t)
	origControl, origTenant := controlDB, tenantMode
	controlDB, tenantMode = db, false
	t.Cleanup(func() { controlDB, tenantMode = origControl, origTenant })

	// last_reading_at is 60s old — well past presenceOverrideWindow (20s) — so
	// this LWT is real: the device has actually gone quiet on both fronts.
	_, err := db.Exec(
		`INSERT INTO device_presence (node_id, online, last_seen, last_reading_at) VALUES ('tr-222', 1, NOW(3), ?)`,
		time.Now().Add(-60*time.Second))
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	updatePresence(TelemetryPayload{NodeID: "tr-222", State: "offline"})

	var online int
	if err := db.QueryRow("SELECT online FROM device_presence WHERE node_id='tr-222'").Scan(&online); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if online != 0 {
		t.Fatalf("online = %d, want 0 (a genuinely silent device must still be marked offline)", online)
	}
	if n := countRows(t, db, "SELECT COUNT(*) FROM transport_events WHERE node_id='tr-222' AND to_transport='none'"); n != 1 {
		t.Fatalf("LINK_LOST rows = %d, want 1", n)
	}
	if n := countRows(t, db, "SELECT COUNT(*) FROM alarm_events WHERE node_id='tr-222' AND kind='offline'"); n != 1 {
		t.Fatalf("offline alarm rows = %d, want 1", n)
	}
}

func TestNoReadingsAtAllStillGoesOffline(t *testing.T) {
	db := openPresenceTestDB(t)
	origControl, origTenant := controlDB, tenantMode
	controlDB, tenantMode = db, false
	t.Cleanup(func() { controlDB, tenantMode = origControl, origTenant })

	// A device that has NEVER stored a reading (last_reading_at NULL) must not
	// be treated as if it had one seconds ago — sql.NullTime.Valid is false,
	// so the override condition must not fire on a NULL.
	_, err := db.Exec(
		`INSERT INTO device_presence (node_id, online, last_seen, last_reading_at) VALUES ('tr-222', 1, NOW(3), NULL)`)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	updatePresence(TelemetryPayload{NodeID: "tr-222", State: "offline"})

	var online int
	if err := db.QueryRow("SELECT online FROM device_presence WHERE node_id='tr-222'").Scan(&online); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if online != 0 {
		t.Fatalf("online = %d, want 0 (NULL last_reading_at must not suppress a real offline)", online)
	}
}

func TestRecoveryStillLogsAfterGenuineOutage(t *testing.T) {
	db := openPresenceTestDB(t)
	origControl, origTenant := controlDB, tenantMode
	controlDB, tenantMode = db, false
	t.Cleanup(func() { controlDB, tenantMode = origControl, origTenant })

	_, err := db.Exec(
		`INSERT INTO device_presence (node_id, online, last_seen, last_reading_at) VALUES ('tr-222', 0, ?, ?)`,
		time.Now().Add(-90*time.Second), time.Now().Add(-90*time.Second))
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, err = db.Exec(
		`INSERT INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,value,threshold,unit,raised_at) VALUES ('ev-1','tr-222','org-1',NULL,'online','Device Offline','CRITICAL','offline',0,0,'',NOW(3))`)
	if err != nil {
		t.Fatalf("seed alarm: %v", err)
	}

	// A regular telemetry frame carries no state field — this is what "back
	// online" looks like on the wire.
	updatePresence(TelemetryPayload{NodeID: "tr-222", State: ""})

	var online int
	if err := db.QueryRow("SELECT online FROM device_presence WHERE node_id='tr-222'").Scan(&online); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if online != 1 {
		t.Fatalf("online = %d, want 1", online)
	}
	if n := countRows(t, db, "SELECT COUNT(*) FROM transport_events WHERE node_id='tr-222' AND to_transport='wifi'"); n != 1 {
		t.Fatalf("LINK_RESTORE rows = %d, want 1", n)
	}
	if n := countRows(t, db, "SELECT COUNT(*) FROM alarm_events WHERE node_id='tr-222' AND cleared_at IS NOT NULL"); n != 1 {
		t.Fatalf("cleared alarm rows = %d, want 1", n)
	}
}
