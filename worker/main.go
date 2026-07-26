package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/go-sql-driver/mysql"
	"github.com/twmb/franz-go/pkg/kgo"
)

type AlarmRule struct {
	NodeID   string
	OrgID    string
	Domain   string
	RuleJSON string
}

type TelemetryPayload struct {
	NodeID    string             `json:"nodeId"`
	Timestamp int64              `json:"ts"`
	Values    map[string]float64 `json:"values"`
	// Firmware identifies itself as device_id on its status/heartbeat/alarm
	// payloads (only the readings payload carries nodeId), so accept it as an
	// alias — otherwise those frames were dropped as "Missing nodeId" and the
	// device's presence (online/offline, rssi, fw, battery) never updated.
	DeviceID string `json:"device_id"`
	// Presence fields (status birth/LWT + heartbeat).
	State     string `json:"state"`
	RSSI      *int   `json:"rssi"`
	Uptime    *int64 `json:"uptime"`
	FW        string `json:"fw"`
	Batt      *int   `json:"batt"`
	Transport string `json:"transport"`
	Heap      *int64 `json:"heap"`
}

// id returns the device identity, accepting either spelling.
func (t TelemetryPayload) id() string {
	if t.NodeID != "" {
		return t.NodeID
	}
	return t.DeviceID
}

// isPresence reports whether this frame is a status/heartbeat rather than a
// readings frame (no values → nothing to persist as readings).
func (t TelemetryPayload) isPresence() bool {
	return len(t.Values) == 0 && (t.State != "" || t.RSSI != nil || t.Uptime != nil || t.Heap != nil)
}

type RuleParam struct {
	Key       string  `json:"key"`
	Label     string  `json:"label"`
	Warn      float64 `json:"warn"`
	Critical  float64 `json:"critical"`
	Direction string  `json:"direction"`
	Unit      string  `json:"unit"`
	Rate      *struct {
		Warn float64 `json:"warn"`
	} `json:"rate,omitempty"`
}

type RuleDefinition struct {
	DwellMin   int         `json:"dwellMin"`
	Hysteresis float64     `json:"hysteresis"`
	Params     []RuleParam `json:"params"`
}

type AlarmParamState struct {
	ActiveLevel string
	RunCount    int
	PrevValue   *float64
}

type AlarmNodeState struct {
	Params map[string]*AlarmParamState
	Mu     sync.Mutex
}

var (
	controlDB   *sql.DB
	tenantMode  bool
	kafkaClient *kgo.Client
	mqttClient  mqtt.Client

	// Caches
	nodeToOrg       sync.Map // string (nodeId) -> OrgCacheEntry
	tenantDBs       sync.Map // string (orgId) -> *sql.DB
	rulesCache      sync.Map // string (nodeId) -> RuleCacheEntry
	alarmStateCache sync.Map // string (nodeId) -> *AlarmNodeState
	orgExistsCache  sync.Map // string (orgId) -> orgExistEntry

	// Regex for DB name sanitization
	nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z0-9]+`)
)

type OrgCacheEntry struct {
	OrgID        string
	DepartmentID string
	Status       string // active | pending | rejected
	ExpiresAt    time.Time
}

type orgExistEntry struct {
	exists    bool
	expiresAt time.Time
}

// UnassignedOrg is the claimable pool a device lands in when its MQTT topic
// carries an org segment that is not a real, active organization. Devices here
// are invisible to tenant admins but visible to superadmins, who reassign each
// to exactly one real org during approval.
const UnassignedOrg = "__unassigned__"

// A reading older than this is treated as replayed backlog rather than live
// telemetry. Kept deliberately short (30s, as before) so that even a brief
// outage still surfaces an OFFLINE_SYNC entry — that entry is how an operator
// knows the gap they saw in the live view has since been filled in. What changed
// is that packets arriving within backlogBatchWindow are folded into ONE counted
// batch row, instead of one row per packet flooding the timeline.
const (
	backlogThreshold   = 30 * time.Second
	backlogBatchWindow = 2 * time.Minute
)

type RuleCacheEntry struct {
	Rule      AlarmRule
	ExpiresAt time.Time
}

func main() {
	// 1. Connect to Control MySQL DB
	var err error
	dsn := dbDSN(getEnv("DB_NAME", "iothub"))
	tenantMode = strings.EqualFold(getEnv("TENANT_DB_MODE", ""), "on")
	controlDB, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("MySQL Control DB Error: %v", err)
	}
	controlDB.SetMaxOpenConns(50)
	controlDB.SetMaxIdleConns(10)
	defer controlDB.Close()
	log.Printf("Worker DB-per-tenant mode: %v", tenantMode)

	// 2. Connect Redpanda
	brokers := []string{getEnv("KAFKA_BROKERS", "redpanda.platform-services.svc.cluster.local:9092")}
	kafkaClient, err = kgo.NewClient(
		kgo.SeedBrokers(brokers...),
	)
	if err != nil {
		log.Fatalf("Redpanda Error: %v", err)
	}
	defer kafkaClient.Close()

	// 3. Connect MQTT broker.
	// Client id must be UNIQUE per instance — a duplicate id makes the broker kick
	// the other connection, so replicas would flap. Default appends the hostname.
	hostname, _ := os.Hostname()
	clientID := getEnv("MQTT_CLIENT_ID", "oneops-ingest-worker-"+hostname)
	// Subscription topic is configurable so the same binary works on any broker:
	//   • prod (EMQX, N replicas): "$share/ingest-worker/telemetry/#" — shared
	//     subscription load-balances each message to exactly one worker.
	//   • single worker / brokers without shared-sub support (e.g. a plain
	//     Mosquitto): set MQTT_SUB_TOPIC="telemetry/#" — a normal subscription.
	subTopic := getEnv("MQTT_SUB_TOPIC", "$share/ingest-worker/telemetry/#")
	opts := mqtt.NewClientOptions().
		AddBroker(getEnv("MQTT_BROKER", "tcp://emqx:1883")).
		SetClientID(clientID).
		SetUsername(getEnv("MQTT_USER", "admin")).
		SetPassword(getEnv("MQTT_PASS", "public")).
		SetKeepAlive(30 * time.Second).
		SetAutoReconnect(true). // survive broker restarts
		SetConnectRetry(true).  // keep trying if the broker isn't up yet at boot
		SetConnectRetryInterval(5 * time.Second).
		SetMaxReconnectInterval(30 * time.Second)

	opts.OnConnect = func(c mqtt.Client) {
		log.Printf("Connected to MQTT broker as %s; subscribing to %q", clientID, subTopic)
		// Re-subscribes automatically on every (re)connect.
		if token := c.Subscribe(subTopic, 1, handleTelemetry); token.Wait() && token.Error() != nil {
			log.Printf("Subscribe error on %q: %v", subTopic, token.Error())
		}
	}
	opts.OnConnectionLost = func(c mqtt.Client, err error) { log.Printf("MQTT connection lost: %v (auto-reconnecting)", err) }

	mqttClient = mqtt.NewClient(opts)
	if token := mqttClient.Connect(); token.Wait() && token.Error() != nil {
		log.Fatalf("MQTT Connect Error: %v", token.Error())
	}

	log.Println("Worker started. Press Ctrl+C to exit.")
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
}

func orgDbName(orgID string) string {
	clean := strings.ToLower(orgID)
	clean = nonAlphanumericRegex.ReplaceAllString(clean, "_")
	clean = strings.Trim(clean, "_")
	if clean == "" {
		return ""
	}
	name := "iothub_" + clean
	if len(name) > 64 {
		name = name[:64]
	}
	return name
}

func resolvePool(orgID string) *sql.DB {
	// Flag off (or no org) → single control DB, exactly like the row-level build.
	if !tenantMode || orgID == "" {
		return controlDB
	}

	// Check cache
	if db, ok := tenantDBs.Load(orgID); ok {
		return db.(*sql.DB)
	}

	// Create new connection pool for this tenant
	dbName := orgDbName(orgID)

	dsn := dbDSN(dbName)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Printf("Failed to open connection to %s: %v", dbName, err)
		return nil
	}

	if err := db.Ping(); err != nil {
		log.Printf("Failed to ping DB %s: %v", dbName, err)
		return nil
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(time.Hour)

	tenantDBs.Store(orgID, db)
	log.Printf("Created DB connection pool for tenant: %s", dbName)
	return db
}

// nodeInfo resolves org/department/status from the control routing index (cached).
// A short TTL keeps admin approvals (pending → active) reflecting quickly. Returns
// ("","","") for an unknown node so the caller can auto-register it.
func nodeInfo(nodeID string) (orgID, depID, status string) {
	if cached, ok := nodeToOrg.Load(nodeID); ok {
		entry := cached.(OrgCacheEntry)
		if time.Now().Before(entry.ExpiresAt) {
			return entry.OrgID, entry.DepartmentID, entry.Status
		}
	}

	var org, dep, st sql.NullString
	err := controlDB.QueryRow("SELECT org_id, department_id, status FROM nodes WHERE id=?", nodeID).Scan(&org, &dep, &st)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("Error resolving node %s: %v", nodeID, err)
		}
		return "", "", "" // unknown → caller auto-registers as pending
	}

	nodeToOrg.Store(nodeID, OrgCacheEntry{
		OrgID:        org.String,
		DepartmentID: dep.String,
		Status:       st.String,
		ExpiresAt:    time.Now().Add(2 * time.Minute),
	})
	return org.String, dep.String, st.String
}

// domainFromProduct maps the MQTT topic's product segment to a nodes.domain enum.
func domainFromProduct(p string) string {
	switch strings.ToLower(p) {
	case "transformer", "eternity", "eternitytransformers":
		return "transformer"
	case "carbonnode", "carbonbox", "refrigeration", "refrigerationdatalogger":
		return "carbonNode"
	case "bloodbox":
		return "bloodBox"
	default:
		return "transformer" // ETERNITY-first default
	}
}

// orgExists reports whether orgID is a real, active organization in the control
// DB (cached with a short TTL). Auto-registration uses this to validate the org
// segment of a device's MQTT topic — an unrecognized org would otherwise create
// a pending node under a phantom org id that no admin (only a raw DB query)
// could ever surface.
func orgExists(orgID string) bool {
	if orgID == "" || orgID == UnassignedOrg {
		return false
	}
	if c, ok := orgExistsCache.Load(orgID); ok {
		e := c.(orgExistEntry)
		if time.Now().Before(e.expiresAt) {
			return e.exists
		}
	}
	var one int
	err := controlDB.QueryRow("SELECT 1 FROM organizations WHERE id=? AND status='active'", orgID).Scan(&one)
	if err != nil && err != sql.ErrNoRows {
		// Transient DB error: don't cache. Treat as unknown so the device lands
		// in the claimable pool (visible to superadmins) rather than a phantom org.
		log.Printf("orgExists check failed for %s: %v", orgID, err)
		return false
	}
	exists := err == nil
	orgExistsCache.Store(orgID, orgExistEntry{exists: exists, expiresAt: time.Now().Add(5 * time.Minute)})
	return exists
}

// autoRegisterPending creates a PENDING node for an unknown device. Org + product
// come from the topic convention telemetry/{orgId}/{product}/{nodeId}. The topic
// org is validated against the control DB; an empty or unrecognized org routes
// the device to the claimable UnassignedOrg pool. The device's data is not
// stored until an admin approves it (status → active).
func autoRegisterPending(nodeID, topic string, sample []byte) {
	parts := strings.Split(topic, "/")
	orgID, product := "", ""
	if len(parts) >= 2 {
		orgID = parts[1]
	}
	if len(parts) >= 3 {
		product = parts[2]
	}
	if orgID == "" || !orgExists(orgID) {
		if orgID != "" {
			log.Printf("Auto-register: node %s topic org %q is not a known active org — routing to %s pool", nodeID, orgID, UnassignedOrg)
		}
		orgID = UnassignedOrg
	}
	prefix := topic
	if len(parts) >= 4 {
		prefix = strings.Join(parts[:4], "/")
	}
	if _, err := controlDB.Exec(
		"INSERT IGNORE INTO nodes (id, org_id, domain, name, mqtt_prefix, status) VALUES (?, ?, ?, ?, ?, 'pending')",
		nodeID, orgID, domainFromProduct(product), nodeID, prefix); err != nil {
		log.Printf("Auto-register failed for node %s: %v", nodeID, err)
		return
	}
	log.Printf("Auto-registered PENDING node %s (org=%s domain=%s) — awaiting approval", nodeID, orgID, domainFromProduct(product))
	touchPending(nodeID, sample)
}

// updatePresence records a status (birth/LWT) or heartbeat frame in
// device_presence: online state plus the diagnostics the fleet screens show
// (rssi/battery/firmware). These frames carry no readings, so they never reach
// the readings path. Presence lives in the control DB for every org.
func updatePresence(t TelemetryPayload) {
	online := 1
	switch strings.ToLower(t.State) {
	case "offline", "asleep":
		online = 0
	}
	// Was this device previously marked offline? Read before the upsert so the
	// recovery can be logged — otherwise a device coming back produced no entry
	// at all on the connectivity timeline, only the silent end of an outage.
	wasOffline := false
	if online == 1 {
		var prev sql.NullInt64
		if err := controlDB.QueryRow("SELECT online FROM device_presence WHERE node_id = ?", t.NodeID).Scan(&prev); err == nil {
			wasOffline = prev.Valid && prev.Int64 == 0
		}
	}
	var rssi, batt interface{}
	if t.RSSI != nil {
		rssi = *t.RSSI
	}
	if t.Batt != nil {
		batt = *t.Batt
	}
	var fw interface{}
	if t.FW != "" {
		fw = t.FW
	}
	if _, err := controlDB.Exec(
		"INSERT INTO device_presence (node_id, online, last_seen, rssi, batt, fw) VALUES (?, ?, NOW(3), ?, ?, ?) "+
			"ON DUPLICATE KEY UPDATE online=VALUES(online), last_seen=VALUES(last_seen), "+
			"rssi=COALESCE(VALUES(rssi),rssi), batt=COALESCE(VALUES(batt),batt), fw=COALESCE(VALUES(fw),fw)",
		t.NodeID, online, rssi, batt, fw); err != nil {
		log.Printf("Presence update failed for %s: %v", t.NodeID, err)
		return
	}
	if wasOffline {
		// from_transport 'none' is what the transport endpoint maps to
		// LINK_RESTORE, so "device is back" sits next to the outage entry.
		transport := t.Transport
		if transport == "" {
			transport = "wifi"
		}
		if _, err := controlDB.Exec(
			"INSERT INTO transport_events (node_id, from_transport, to_transport, reason, rssi, ts) VALUES (?,?,?,?,?,NOW(3))",
			t.NodeID, "none", transport, "recovered", rssi); err != nil {
			log.Printf("Recovery event failed for %s: %v", t.NodeID, err)
		}
		// Close the open offline alarm so the device stops looking down.
		if _, err := controlDB.Exec(
			"UPDATE alarm_events SET cleared_at = NOW(3) WHERE node_id = ? AND kind = 'offline' AND cleared_at IS NULL",
			t.NodeID); err != nil {
			log.Printf("Clear offline alarm failed for %s: %v", t.NodeID, err)
		}
		log.Printf("Device back online: %s", t.NodeID)
	}
}

// touchPending refreshes a pending device's presence (control DB) so the approval
// screen shows it is still transmitting, and stores the latest sample values so
// the admin can sanity-check the readings before approving.
func touchPending(nodeID string, sample []byte) {
	if len(sample) == 0 {
		_, _ = controlDB.Exec(
			"INSERT INTO device_presence (node_id, online, last_seen) VALUES (?, 1, NOW(3)) ON DUPLICATE KEY UPDATE online=1, last_seen=NOW(3)",
			nodeID)
		return
	}
	_, _ = controlDB.Exec(
		"INSERT INTO device_presence (node_id, online, last_seen, last_sample) VALUES (?, 1, NOW(3), ?) ON DUPLICATE KEY UPDATE online=1, last_seen=NOW(3), last_sample=VALUES(last_sample)",
		nodeID, string(sample))
}

func getAlarmRule(tenantDB *sql.DB, nodeID string) (AlarmRule, bool) {
	if cached, ok := rulesCache.Load(nodeID); ok {
		entry := cached.(RuleCacheEntry)
		if time.Now().Before(entry.ExpiresAt) {
			return entry.Rule, true
		}
	}

	var r AlarmRule
	err := tenantDB.QueryRow("SELECT node_id, org_id, domain, rule_json FROM alarm_rules WHERE node_id=?", nodeID).
		Scan(&r.NodeID, &r.OrgID, &r.Domain, &r.RuleJSON)

	if err != nil {
		if err != sql.ErrNoRows {
			// This is normal if the device has no alarm rule configured
			// log.Printf("Error fetching alarm rule for node %s: %v", nodeID, err)
		}
		return AlarmRule{}, false
	}

	rulesCache.Store(nodeID, RuleCacheEntry{
		Rule:      r,
		ExpiresAt: time.Now().Add(5 * time.Minute),
	})
	return r, true
}

func breaches(v, l float64, dir string) bool {
	if dir == "high" {
		return v >= l
	}
	return v <= l
}

func cleared(v, l, h float64, dir string) bool {
	if dir == "high" {
		return v < l-h
	}
	return v > l+h
}

func evaluateAlarms(tenantDB *sql.DB, client mqtt.Client, orgID, depID string, t TelemetryPayload, ts time.Time, rule AlarmRule) {
	var ruleDef RuleDefinition
	if err := json.Unmarshal([]byte(rule.RuleJSON), &ruleDef); err != nil {
		log.Printf("Failed to unmarshal rule JSON for node %s: %v", t.NodeID, err)
		return
	}

	stateVal, _ := alarmStateCache.LoadOrStore(t.NodeID, &AlarmNodeState{
		Params: make(map[string]*AlarmParamState),
	})
	ns := stateVal.(*AlarmNodeState)

	ns.Mu.Lock()
	defer ns.Mu.Unlock()

	for _, p := range ruleDef.Params {
		val, exists := t.Values[p.Key]
		if !exists {
			continue
		}

		ps, ok := ns.Params[p.Key]
		if !ok {
			ps = &AlarmParamState{}
			ns.Params[p.Key] = ps
		}

		// Rate Check
		if p.Rate != nil && ps.PrevValue != nil {
			var d float64
			if p.Direction == "high" {
				d = val - *ps.PrevValue
			} else {
				d = *ps.PrevValue - val
			}
			if d >= p.Rate.Warn {
				emitAlarm(tenantDB, client, orgID, depID, t, ts, p, "WARNING", "rate", val, p.Rate.Warn)
			}
		}

		valCopy := val
		ps.PrevValue = &valCopy

		// Threshold Check
		lvl := ""
		if breaches(val, p.Critical, p.Direction) {
			lvl = "CRITICAL"
		} else if breaches(val, p.Warn, p.Direction) {
			lvl = "WARNING"
		}

		dwellMin := ruleDef.DwellMin
		if dwellMin <= 0 {
			dwellMin = 3 // default
		}

		if lvl != "" {
			ps.RunCount++
			if ps.RunCount >= dwellMin && lvl != ps.ActiveLevel {
				if ps.ActiveLevel == "" || (ps.ActiveLevel == "WARNING" && lvl == "CRITICAL") {
					thresh := p.Warn
					if lvl == "CRITICAL" {
						thresh = p.Critical
					}
					emitAlarm(tenantDB, client, orgID, depID, t, ts, p, lvl, "threshold", val, thresh)
				}
				ps.ActiveLevel = lvl
			}
		} else if ps.ActiveLevel != "" && cleared(val, p.Warn, ruleDef.Hysteresis, p.Direction) {
			ps.ActiveLevel = ""
			ps.RunCount = 0
		} else if lvl == "" {
			ps.RunCount = 0
		}
	}
}

func emitAlarm(tenantDB *sql.DB, client mqtt.Client, orgID, depID string, t TelemetryPayload, ts time.Time, p RuleParam, sev, kind string, val, thresh float64) {
	// Deterministic id (matches Node-RED) → INSERT IGNORE is idempotent.
	id := fmt.Sprintf("ev-%s-%s-%d-%s", t.NodeID, p.Key, ts.UnixMilli(), kind)

	// Columns + NOT-NULLs must match schema.sql alarm_events (id PK, org_id,
	// param_label, raised_at are NOT NULL; the timestamp column is raised_at, not ts).
	var dep interface{}
	if depID != "" {
		dep = depID
	}
	_, err := tenantDB.Exec(`
		INSERT IGNORE INTO alarm_events
		  (id, node_id, org_id, department_id, param_key, param_label, severity, kind, value, threshold, unit, raised_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, t.NodeID, orgID, dep, p.Key, p.Label, sev, kind, val, thresh, p.Unit, ts)

	if err != nil {
		log.Printf("Failed to insert alarm event: %v", err)
	}

	// Publish WebSocket Enrichment Event
	ev := map[string]interface{}{
		"id":           id,
		"nodeId":       t.NodeID,
		"orgId":        orgID,
		"departmentId": depID,
		"paramKey":     p.Key,
		"paramLabel":   p.Label,
		"severity":     sev,
		"kind":         kind,
		"value":        val,
		"threshold":    thresh,
		"unit":         p.Unit,
		"ts":           ts.UnixMilli(),
	}

	evBytes, _ := json.Marshal(ev)

	dispOrg := orgID
	if dispOrg == "" {
		dispOrg = "default"
	}
	client.Publish(fmt.Sprintf("internal/alarms/live/%s/%s", dispOrg, t.NodeID), 0, false, evBytes)
}

func handleTelemetry(client mqtt.Client, msg mqtt.Message) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Recovered in handleTelemetry: %v", r)
		}
	}()

	payload := msg.Payload()

	var t TelemetryPayload
	if err := json.Unmarshal(payload, &t); err != nil {
		log.Printf("Failed to parse telemetry: %v", err)
		return
	}

	// Accept device_id as an alias for nodeId (firmware status/heartbeat frames).
	t.NodeID = t.id()
	if t.NodeID == "" {
		log.Printf("Missing nodeId/device_id in telemetry payload")
		return
	}

	// Always record presence (every frame means the device is online)
	updatePresence(t)

	// Status (birth/LWT) and heartbeat frames carry no readings — stop here
	// instead of falling through the readings path.
	if t.isPresence() {
		return
	}

	var ts time.Time
	if t.Timestamp > 0 {
		// Assume timestamp in milliseconds
		ts = time.UnixMilli(t.Timestamp)
	} else {
		ts = time.Now()
		t.Timestamp = ts.UnixMilli()
	}

	record := &kgo.Record{
		Topic: "telemetry-events",
		Key:   []byte(t.NodeID),
		Value: payload,
	}
	kafkaClient.Produce(context.Background(), record, nil)

	orgID, depID, status := nodeInfo(t.NodeID)

	// Zero-touch onboarding: an unknown device is auto-registered as a PENDING
	// node (org from its topic) and awaits admin approval — its data is dropped
	// until approved. Known-but-not-approved (pending/rejected) devices are kept
	// "alive" for the approval screen but likewise store no readings/alarms.
	if orgID == "" {
		sample, _ := json.Marshal(t.Values)
		autoRegisterPending(t.NodeID, msg.Topic(), sample)
		return
	}
	if status == "pending" || status == "rejected" {
		if status == "pending" {
			sample, _ := json.Marshal(t.Values)
			touchPending(t.NodeID, sample)
			// Process telemetry even while pending so admins see live values
			// during approval (last_sample + live view), instead of dropping it.
		} else {
			return
		}
	}

	tenantDB := resolvePool(orgID)
	if tenantDB == nil {
		log.Printf("Dropped telemetry: could not connect to tenant DB for org %s", orgID)
		return
	}

	// Backlog check. A device replaying stored readings sends many packets at
	// once, and a 30s threshold also trips on ordinary clock skew — the old code
	// wrote ONE row per packet, so the connectivity timeline filled with
	// "Flushed 1 offline record" lines. Use a wider threshold and fold packets
	// that arrive close together into a single, counted batch row.
	if time.Since(ts) > backlogThreshold {
		res, err := tenantDB.Exec(
			"UPDATE offline_sync_log SET records_count = records_count + 1, oldest_ts = LEAST(oldest_ts, ?), newest_ts = GREATEST(newest_ts, ?), sync_at = NOW(3) "+
				"WHERE node_id = ? AND sync_at > (NOW(3) - INTERVAL ? SECOND) ORDER BY sync_at DESC LIMIT 1",
			ts, ts, t.NodeID, int(backlogBatchWindow.Seconds()))
		affected := int64(0)
		if err == nil {
			affected, _ = res.RowsAffected()
		}
		if affected == 0 {
			if _, err := tenantDB.Exec(
				"INSERT INTO offline_sync_log (node_id, records_count, oldest_ts, newest_ts) VALUES (?, 1, ?, ?)",
				t.NodeID, ts, ts); err != nil {
				log.Printf("Failed to insert offline_sync_log: %v", err)
			}
		}
	}

	// Store readings under the CANONICAL param key (ALARM_SCHEMA), not the raw
	// wire key, so alarm rules and the device pages (which look up oilTemp,
	// hydrogen, …) find them. Unmapped keys are stored as-is.
	normalized := make(map[string]float64, len(t.Values)+1)
	for key, val := range t.Values {
		// A single measured temperature feeds BOTH carbonNode/bloodBox bounds
		// (tempHigh = too warm, tempLow = too cold), mirroring the Node-RED
		// normalize step — without this the fridge pages find no tempHigh/tempLow
		// and fall back to mock values.
		if key == "temp_c" {
			normalized["tempHigh"] = val
			normalized["tempLow"] = val
			continue
		}
		normalized[canonicalParam(key)] = val
	}
	t.Values = normalized

	for key, val := range t.Values {
		_, err := tenantDB.Exec("INSERT IGNORE INTO readings (node_id, param_key, value, taken_at) VALUES (?, ?, ?, ?)",
			t.NodeID, key, val, ts)
		if err != nil {
			log.Printf("DB Insert Error for org %s: %v", orgID, err)
		}
	}

	// Enrichment for WebSocket UI. Publish the CANONICAL values (same keys just
	// written to readings) so the live frame and the stored history agree —
	// otherwise the UI shows each metric twice, once per spelling.
	var enrichedPayload map[string]interface{}
	json.Unmarshal(payload, &enrichedPayload)
	enrichedPayload["values"] = t.Values
	enrichedPayload["orgId"] = orgID
	enrichedPayload["departmentId"] = depID
	enrichedPayload["ts"] = t.Timestamp // ensure ts is numeric
	enrichedBytes, _ := json.Marshal(enrichedPayload)

	dispOrg := orgID
	if dispOrg == "" {
		dispOrg = "default"
	}
	client.Publish(fmt.Sprintf("internal/telemetry/live/%s/%s", dispOrg, t.NodeID), 0, false, enrichedBytes)

	rule, ok := getAlarmRule(tenantDB, t.NodeID)
	if ok {
		evaluateAlarms(tenantDB, client, orgID, depID, t, ts, rule)
	}
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

// paramMap maps raw device wire keys to the platform's canonical param keys
// (ALARM_SCHEMA / the Node-RED normalize MAP). Devices publish e.g. oil_temp_c;
// alarm rules and the UI address oilTemp. Both DGA spellings are accepted
// because firmware in the field sends dga_h2_ppm.
var paramMap = map[string]string{
	"oil_temp_c":           "oilTemp",
	"ambient_temp_c":       "ambientTemp",
	"winding_temp_c":       "windingTemp",
	"dga_h2_ppm":           "hydrogen",
	"hydrogen_ppm":         "hydrogen",
	"moisture_ppm":         "moisture",
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

// canonicalParam returns the canonical key for a raw wire key (unchanged when
// the key is already canonical or unknown, so new sensors still flow through).
func canonicalParam(key string) string {
	if c, ok := paramMap[key]; ok {
		return c
	}
	return key
}

// dbDSN builds the MySQL DSN for a database from component env vars using the
// driver's own config formatter. FormatDSN properly encodes the password, so a
// root password containing DSN-special characters (@ : / ?) — common for
// randomly generated secrets — does not corrupt the connection string. Building
// the DSN by hand (root:PASS@tcp(...)) mis-parses such passwords and yields
// "Access denied", even though the CLI (mysql -p) and mysql2 (separate field)
// accept the same value. DB_PASSWORD comes from the mysql-credentials Secret.
func dbDSN(dbName string) string {
	cfg := mysql.NewConfig()
	cfg.User = getEnv("DB_USER", "root")
	cfg.Passwd = getEnv("DB_PASSWORD", "password")
	cfg.Net = "tcp"
	cfg.Addr = getEnv("DB_HOST", "mysql") + ":" + getEnv("DB_PORT", "3306")
	cfg.DBName = dbName
	cfg.ParseTime = true
	return cfg.FormatDSN()
}
