package main

import (
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestDbLocOffsetAndConnector(t *testing.T) {
	t.Setenv("DB_TZ", "+07:00")
	loc := dbLoc()
	_, off := time.Now().In(loc).Zone()
	if off != 7*3600 {
		t.Fatalf("offset = %d, want 25200", off)
	}
	// The old path: FormatDSN writes loc=DBTZ, ParseDSN then LoadLocation("DBTZ").
	if _, err := mysql.ParseDSN(dbConfig("iothub").FormatDSN()); err == nil {
		t.Log("NOTE: DSN round-trip unexpectedly succeeded")
	} else {
		t.Logf("DSN round-trip fails as observed in prod: %v", err)
	}
	// The new path must succeed.
	if _, err := mysql.NewConnector(dbConfig("iothub")); err != nil {
		t.Fatalf("NewConnector: %v", err)
	}
	// A wall time must serialise in +07:00.
	utc := time.Date(2026, 7, 26, 16, 22, 38, 0, time.UTC)
	if got := utc.In(loc).Format("2006-01-02 15:04:05"); got != "2026-07-26 23:22:38" {
		t.Fatalf("wall time = %s, want 2026-07-26 23:22:38", got)
	}
}

func TestDbLocFallback(t *testing.T) {
	t.Setenv("DB_TZ", "garbage")
	_, off := time.Now().In(dbLoc()).Zone()
	if off != 7*3600 {
		t.Fatalf("fallback offset = %d, want 25200", off)
	}
}
