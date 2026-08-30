package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/go-sql-driver/mysql"
	"github.com/twmb/franz-go/pkg/kgo"
)

type ParamDebounce struct {
	DwellMin  *int `json:"dwell_min,omitempty"`
	CooldownS *int `json:"cooldown_s,omitempty"`
}

type AlarmRule struct {
	NodeID       string
	OrgID        string
	Domain       string
	RuleJSON     string
	DebounceJSON sql.NullString
}

type TelemetryPayload struct {
	NodeID      string             `json:"nodeId"`
	NodeIDSnake string             `json:"node_id"`
	Timestamp   int64              `json:"ts"`
	Values      map[string]float64 `json:"values"`
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
	MAC       string `json:"mac,omitempty"`
	Channel   string `json:"channel,omitempty"`
}

// id returns the device identity, accepting either spelling.
func (t TelemetryPayload) id() string {
	if t.NodeID != "" {
		return t.NodeID
	}
	if t.NodeIDSnake != "" {
		return t.NodeIDSnake
	}
	return t.DeviceID
}

// dropNullValues removes keys the device published as JSON null from values.
// encoding/json silently decodes a null into map[string]float64 as 0.0 — a
// sensor with nothing to report (e.g. THD_VoltBC: null seen on a real payload)
// would otherwise be stored and alarmed on as a genuine zero reading, the same
// class of fabricated-number bug this codebase has already been through once.
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

// ── Device clock sanity ────────────────────────────────────────────────────
//
// A device timestamp used to be trusted on the single test `> 0`. Every ESP32
// failure mode around clocks lands outside that check and is silent:
//
//   - seconds instead of milliseconds — the most common firmware slip. A real
//     1787402633520 sent as 1787402633 is read as 1970-01-21, 56 years back.
//   - booted, publishing, NTP not synced yet — time() is near zero or is
//     millis() since boot, so again 1970.
//   - a clock set into the future — nothing bounded that at all.
//
// None of these produce an error anywhere. A past-dated reading is stored,
// rolled into a phantom rollup bucket, then deleted by the next retention
// tick for being older than READINGS_RETENTION_DAYS — the operator sees a
// device that is plainly online reporting no data, with nothing in the logs.
// A future-dated one is worse: it is never purged, never appears in a "last
// 24h" window, and poisons the rate-of-rise anchor (AlarmParamState.
// PrevValueTs). Every later frame then computes a NEGATIVE elapsed, fails the
// minimum-span test, and never advances the anchor — so rate-of-rise stays
// dead for that parameter until the worker restarts.
const (
	// Readings older than this are treated as a wrong clock rather than as
	// history. Comfortably wider than any offline backlog the store-and-forward
	// buffer replays (offline_sync_log), so a genuine catch-up is not rejected.
	maxClockLag = 90 * 24 * time.Hour
	// Nothing measured can be dated ahead of now. A small allowance absorbs
	// ordinary NTP jitter and the flight time of the frame itself.
	maxClockSkewAhead = 5 * time.Minute
)

// acceptTimestamp turns a device-supplied epoch-ms into a trustworthy time.
// Out-of-range values fall back to arrival time — the reading itself is real
// and is kept; only its claimed clock is not believed.
func acceptTimestamp(nodeID string, epochMs int64) time.Time {
	now := time.Now()
	if epochMs <= 0 {
		return now
	}
	ts := time.UnixMilli(epochMs)
	if ts.After(now.Add(maxClockSkewAhead)) {
		statClockRejected.Add(1)
		log.Printf("Clock skew %s: timestamp %s is in the future — using arrival time instead", nodeID, ts.Format(time.RFC3339))
		return now
	}
	if now.Sub(ts) > maxClockLag {
		statClockRejected.Add(1)
		// Name the likely cause: a 10-digit value is seconds, and dividing a
		// real millisecond clock by 1000 lands almost exactly here.
		hint := "device clock not set (NTP not synced?)"
		if epochMs > 1_000_000_000 && epochMs < 10_000_000_000 {
			hint = "looks like SECONDS sent where milliseconds are expected"
		}
		log.Printf("Clock skew %s: timestamp %s is %s old — %s; using arrival time instead",
			nodeID, ts.Format(time.RFC3339), now.Sub(ts).Round(time.Hour), hint)
		return now
	}
	return ts
}

// topicNodeID returns the node id a telemetry topic names, or "" when the topic
// does not follow the convention.
//
// The convention is telemetry/{orgId}/{product}/{nodeId}[/...] — the same one
// autoRegisterPending already parses for the org and product segments, and the
// same one every real frame observed from the fleet uses. Subtopics under the
// node id (…/alarm/{sid}, …/status) keep the id in the same position, so the
// index is fixed rather than counted from the end.
func topicNodeID(topic string) string {
	parts := strings.Split(topic, "/")
	// A shared subscription ($share/{group}/…) is stripped by the broker before
	// delivery, so what arrives here is always the publish topic itself.
	if len(parts) < 4 || parts[0] != "telemetry" {
		return ""
	}
	return parts[3]
}

// stripMacSuffix checks if a nodeId or topic segment ends with an underscore
// followed by a 12-character hex MAC address (e.g. "tr-221_246F28A1B2C3").
// If so, it returns the base asset ID ("tr-221") and the extracted MAC.
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

// normalizeMAC standardizes both compact hex ("246F28A1B2C3") and colon-delimited
// ("24:6F:28:A1:B2:C3") MAC addresses into canonical format with colons and compact format.
func normalizeMAC(raw string) (canonical string, compact string) {
	clean := strings.ToUpper(strings.TrimSpace(raw))
	clean = strings.ReplaceAll(clean, ":", "")
	clean = strings.ReplaceAll(clean, "-", "")
	if len(clean) != 12 {
		return raw, clean
	}
	for _, c := range clean {
		if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F')) {
			return raw, clean
		}
	}
	canonical = fmt.Sprintf("%s:%s:%s:%s:%s:%s",
		clean[0:2], clean[2:4], clean[4:6], clean[6:8], clean[8:10], clean[10:12])
	return canonical, clean
}

// identityEnforced reports whether a frame whose payload nodeId disagrees with
// its topic should be REJECTED (true) or merely logged (false).
//
// Enforcing is the correct posture and the default: MQTT authorises a PUBLISH
// by topic, so the topic is the only part of a frame the broker's ACL has any
// say over. The payload is opaque to it. Trusting the payload's nodeId while
// the ACL guards the topic means a device permitted to publish only its own
// topic can still write readings, and raise alarms, as ANY other node in ANY
// other org simply by naming it in the body.
//
// MQTT_IDENTITY_ENFORCE=warn downgrades this to log-only. That exists for one
// job: a fleet with firmware nobody has audited yet can be watched for a few
// days ("0 rejected" in the heartbeat line means nothing disagrees) before the
// control is armed. It is not a setting to leave on.
func identityEnforced() bool {
	return !strings.EqualFold(strings.TrimSpace(getEnv("MQTT_IDENTITY_ENFORCE", "enforce")), "warn")
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
	Enabled   *bool   `json:"enabled,omitempty"`
	Rate      *struct {
		// Unit carries the rate's own time base ('ppm/day', '°C/h') and was
		// previously dropped during unmarshal — leaving the worker with a
		// threshold number and no idea what period it applied to, which is
		// how the rate check ended up comparing a raw frame-to-frame delta
		// against a per-day limit.
		Unit string  `json:"unit"`
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
	// Rate anchor: the sample a rate-of-rise check measures the current one
	// against. Deliberately NOT "the previous sample" — a rate needs a
	// meaningful span of time behind it, so this only advances once enough has
	// elapsed (see rateMinDivisor).
	PrevValue    *float64
	PrevValueTs  time.Time
	LastRaisedAt time.Time
}

type AlarmNodeState struct {
	Params map[string]*AlarmParamState
	Mu     sync.Mutex
}

// Throughput counters for the periodic heartbeat below. Without it the worker is
// completely silent while everything is healthy, which is indistinguishable from
// a worker that has died or lost its subscription.
var (
	statReadings atomic.Int64
	statPresence atomic.Int64
	statDropped  atomic.Int64
	statErrors   atomic.Int64
	// Frames whose payload nodeId disagreed with the topic that carried them.
	// Surfaced in the heartbeat line because the number an operator needs
	// before arming enforcement is "is this ever non-zero on my fleet?".
	statIdentityRejected atomic.Int64
	// Nodes newly flagged as having two devices publishing under one id.
	statIdentityConflicts atomic.Int64
	// Frames whose device clock was outside the trustworthy window and were
	// stamped with arrival time instead. A steadily rising count means a
	// device's clock needs fixing, not that the platform is dropping data.
	statClockRejected atomic.Int64
	statDevices       sync.Map // nodeId -> struct{}, distinct devices seen this window

	startTime         = time.Now()
	lastTelemetryUnix atomic.Int64
	mqttConnected     atomic.Bool
)

var (
	controlDB   *sql.DB
	tenantMode  bool
	kafkaClient *kgo.Client
	mqttClient  mqtt.Client

	// Caches
	nodeToOrg       sync.Map // string (nodeId) -> OrgCacheEntry
	tenantDBs       sync.Map // string (orgId) -> *sql.DB
	metricSlewCache sync.Map // string ("nodeId:paramKey") -> metricSlewEntry
)

type metricSlewEntry struct {
	val float64
	ts  time.Time
}

func checkPhysicalSlew(nodeID, key string, val float64, ts time.Time) (bool, float64) {
	var maxRatePerSec float64
	switch key {
	case "oilTemp", "ambientTemp", "Tbox":
		maxRatePerSec = 0.5 // max 30°C/min
	case "windingTemp":
		maxRatePerSec = 1.0 // max 60°C/min
	case "hydrogen":
		maxRatePerSec = 10.0 // max 10 ppm/sec
	case "moisture", "oilMoisture":
		maxRatePerSec = 2.0 // max 2 ppm/sec
	default:
		return false, 0
	}

	cacheKey := nodeID + ":" + key
	raw, ok := metricSlewCache.Load(cacheKey)
	metricSlewCache.Store(cacheKey, metricSlewEntry{val: val, ts: ts})
	if !ok {
		return false, 0
	}
	prev := raw.(metricSlewEntry)
	deltaSec := ts.Sub(prev.ts).Seconds()
	if deltaSec <= 0 || deltaSec > 60 {
		return false, 0
	}
	diff := val - prev.val
	if diff < 0 {
		diff = -diff
	}
	if diff > 3.0 && (diff/deltaSec) > maxRatePerSec {
		return true, diff
	}
	return false, 0
}

var (
	rulesCache      sync.Map // string (nodeId) -> RuleCacheEntry
	alarmStateCache sync.Map // string (nodeId) -> *AlarmNodeState
	orgExistsCache  sync.Map // string (orgId) -> orgExistEntry

	// Personal (per-user, per-node) alarm thresholds — independent of the
	// shared rule/state above. Keyed separately (node vs userId+"\x1f"+node)
	// so a personal breach can never read or clobber the shared org state,
	// and vice versa.
	personalRulesCache      sync.Map // string (nodeId) -> PersonalRulesCacheEntry
	personalAlarmStateCache sync.Map // string (userId+"\x1f"+nodeId) -> *AlarmNodeState

	// Regex for DB name sanitization
	nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z0-9]+`)
)

type OrgCacheEntry struct {
	OrgID        string
	DepartmentID string
	Status       string // active | pending | rejected
	MergeInto    string // non-empty → this feed's readings belong to that node
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
	// How long to wait before retrying the last_reading_at stamp after it fails
	// (i.e. before migrate-v19 has run).
	lastReadingRetry = 5 * time.Minute
	// How recent a stored reading has to be to override an LWT/offline status
	// claim on a merged node's shared presence row. Matches LINK_LOST_AFTER_S on
	// the Node-RED sweep (see updatePresence) — both exist to answer the same
	// question ("has this device really gone silent?") from the same signal.
	presenceOverrideWindow = 20 * time.Second
)

// Unix-ms of the next allowed last_reading_at attempt; 0 = attempt now.
var lastReadingRetryAt atomic.Int64

type RuleCacheEntry struct {
	Rule      AlarmRule
	ExpiresAt time.Time
}

// PersonalRule is one user's own threshold set for one node — "notify me
// when MY reading crosses MY limit," never the shared alarm_rules row
// everyone (including admins) sees for this device.
type PersonalRule struct {
	UserID   string
	Domain   string
	RuleJSON string
}

type PersonalRulesCacheEntry struct {
	Rules     []PersonalRule
	ExpiresAt time.Time
}

func main() {
	// 1. Connect to Control MySQL DB
	var err error
	tenantMode = strings.EqualFold(getEnv("TENANT_DB_MODE", ""), "on")
	controlDB, err = openDB(getEnv("DB_NAME", "iothub"))
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
	// the other connection, so replicas would flap. Append a random nonce to ensure uniqueness.
	hostname, _ := os.Hostname()
	baseClientID := getEnv("MQTT_CLIENT_ID", "oneops-ingest-worker-"+hostname)
	clientID := fmt.Sprintf("%s-%04x", baseClientID, time.Now().UnixNano()&0xffff)

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
		SetPingTimeout(10 * time.Second).
		SetWriteTimeout(10 * time.Second).
		SetAutoReconnect(true). // survive broker restarts
		SetConnectRetry(true).  // keep trying if the broker isn't up yet at boot
		SetConnectRetryInterval(3 * time.Second).
		SetMaxReconnectInterval(10 * time.Second).
		SetResumeSubs(true) // crucial: enables queuing/resuming subscriptions on reconnect

	opts.OnConnect = func(c mqtt.Client) {
		mqttConnected.Store(true)
		log.Printf("[mqtt] Connected to MQTT broker as %s; subscribing to %q", clientID, subTopic)
		// Re-subscribes automatically on every (re)connect with a 10s timeout to prevent hanging.
		if token := c.Subscribe(subTopic, 1, handleTelemetry); token.WaitTimeout(10 * time.Second) {
			if token.Error() != nil {
				log.Printf("[mqtt] ERROR: Subscribe error on %q: %v", subTopic, token.Error())
			} else {
				log.Printf("[mqtt] Successfully subscribed to %q", subTopic)
			}
		} else {
			log.Printf("[mqtt] WARN: Subscribe to %q timed out after 10s", subTopic)
		}
	}
	opts.OnConnectionLost = func(c mqtt.Client, err error) {
		mqttConnected.Store(false)
		log.Printf("[mqtt] Connection lost: %v (auto-reconnecting...)", err)
	}

	mqttClient = mqtt.NewClient(opts)
	if token := mqttClient.Connect(); token.WaitTimeout(15*time.Second) && token.Error() != nil {
		log.Fatalf("MQTT Connect Error: %v", token.Error())
	}

	// 4. Start HTTP health check server for Kubernetes liveness & readiness probes
	healthPort := getEnv("HEALTH_PORT", "8080")
	go startHealthServer(healthPort)

	// 5. Start background watchdog, offline sweep & throughput monitor
	go startMqttWatchdog(mqttClient, subTopic)
	go startOfflineSweep(30*time.Second, 90)
	go heartbeatLoop()

	log.Println("Worker started. Press Ctrl+C to exit.")
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
}

// startMqttWatchdog proactively detects and recovers from silent subscription loss
// or deadlocked connections when the broker restarts or drops sessions without socket closure.
func startMqttWatchdog(client mqtt.Client, subTopic string) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	subErrCount := 0

	for range ticker.C {
		connected := client != nil && client.IsConnected()
		mqttConnected.Store(connected)

		if !connected {
			subErrCount++
			log.Printf("[watchdog] MQTT disconnected (tick %d); waiting for automatic reconnection...", subErrCount)
			if subErrCount >= 4 { // > 2 minutes disconnected
				log.Println("[watchdog] Persistent disconnect detected. Forcing clean reconnect cycle...")
				client.Disconnect(250)
				time.Sleep(500 * time.Millisecond)
				if token := client.Connect(); token.WaitTimeout(10*time.Second) && token.Error() != nil {
					log.Printf("[watchdog] Force reconnect failed: %v", token.Error())
				} else {
					log.Println("[watchdog] Force reconnect succeeded")
					subErrCount = 0
				}
			}
			continue
		}

		lastMs := lastTelemetryUnix.Load()
		if lastMs == 0 {
			// No telemetry received yet since startup
			if time.Since(startTime) > 2*time.Minute {
				log.Printf("[watchdog] WARN: No telemetry received since startup (%s ago); re-verifying subscription on %q...",
					time.Since(startTime).Round(time.Second), subTopic)
				if token := client.Subscribe(subTopic, 1, handleTelemetry); token.WaitTimeout(5 * time.Second) {
					if token.Error() != nil {
						log.Printf("[watchdog] Re-subscription error on %q: %v", subTopic, token.Error())
						subErrCount++
						if subErrCount >= 2 {
							log.Println("[watchdog] Re-subscription failed repeatedly. Forcing clean reconnect cycle...")
							client.Disconnect(250)
							time.Sleep(500 * time.Millisecond)
							client.Connect()
							subErrCount = 0
						}
					} else {
						log.Printf("[watchdog] Re-subscription confirmed on %q", subTopic)
						subErrCount = 0
					}
				}
			}
			continue
		}

		lastTime := time.Unix(lastMs, 0)
		idle := time.Since(lastTime)
		// If devices were publishing but nothing received for > 3 minutes while connected (silent drop)
		if idle > 3*time.Minute {
			log.Printf("[watchdog] WARN: No telemetry received for %s (silent subscription drop suspected); refreshing subscription on %q...",
				idle.Round(time.Second), subTopic)
			if token := client.Subscribe(subTopic, 1, handleTelemetry); token.WaitTimeout(5 * time.Second) {
				if token.Error() != nil {
					log.Printf("[watchdog] Re-subscription error: %v", token.Error())
					subErrCount++
					if subErrCount >= 2 {
						log.Println("[watchdog] Re-subscription error limit reached. Forcing clean reconnect cycle...")
						client.Disconnect(250)
						time.Sleep(500 * time.Millisecond)
						client.Connect()
						subErrCount = 0
					}
				} else {
					log.Printf("[watchdog] Re-subscription refreshed successfully on %q", subTopic)
					subErrCount = 0
				}
			}
		}
	}
}

// startOfflineSweep periodically checks for devices that have silently gone offline
// (stopped transmitting without sending an MQTT LWT packet).
func startOfflineSweep(interval time.Duration, offlineAfterSeconds int) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		if controlDB == nil {
			continue
		}
		// Find online devices whose last_seen timestamp is older than offlineAfterSeconds
		rows, err := controlDB.Query(`
			SELECT p.node_id, n.org_id, n.department_id, COALESCE(p.transport, 'wifi') AS transport, p.last_seen
			FROM device_presence p
			JOIN nodes n ON n.id = p.node_id
			WHERE p.online = 1 AND p.last_seen < (NOW(3) - INTERVAL ? SECOND)
		`, offlineAfterSeconds)
		if err != nil {
			// If table or column not ready yet, continue silently
			continue
		}

		type staleNode struct {
			nodeID       string
			orgID        string
			departmentID sql.NullString
			transport    string
			lastSeen     sql.NullTime
		}
		var stale []staleNode
		for rows.Next() {
			var s staleNode
			if err := rows.Scan(&s.nodeID, &s.orgID, &s.departmentID, &s.transport, &s.lastSeen); err == nil {
				stale = append(stale, s)
			}
		}
		rows.Close()

		for _, s := range stale {
			// 1. Mark device offline in controlDB
			if _, err := controlDB.Exec("UPDATE device_presence SET online = 0 WHERE node_id = ?", s.nodeID); err != nil {
				log.Printf("[offline-sweep] Failed to update presence for %s: %v", s.nodeID, err)
				continue
			}
			log.Printf("[offline-sweep] Device %s timed out (>%ds without data), marked OFFLINE", s.nodeID, offlineAfterSeconds)

			targetDB := resolvePool(s.orgID)
			if targetDB == nil {
				targetDB = controlDB
			}

			// 2. Insert LINK_LOST event into targetDB (tenant DB)
			if _, err := targetDB.Exec(`
				INSERT INTO transport_events (node_id, from_transport, to_transport, reason, rssi, ts)
				VALUES (?, ?, 'none', 'timeout', NULL, NOW(3))
			`, s.nodeID, s.transport); err != nil {
				log.Printf("[offline-sweep] Failed to insert transport_events for %s: %v", s.nodeID, err)
			}

			// 3. Insert Device Offline CRITICAL alarm into targetDB (tenant DB)
			alarmID := fmt.Sprintf("ev-offline-%s-%d", s.nodeID, time.Now().UnixMilli())
			if _, err := targetDB.Exec(`
				INSERT IGNORE INTO alarm_events (id, node_id, org_id, department_id, param_key, param_label, severity, kind, value, threshold, unit, raised_at)
				VALUES (?, ?, ?, ?, 'online', 'Device Offline', 'CRITICAL', 'offline', 0, 0, '', NOW(3))
			`, alarmID, s.nodeID, s.orgID, nullableStr(s.departmentID)); err != nil {
				log.Printf("[offline-sweep] Failed to insert offline alarm for %s: %v", s.nodeID, err)
			}

			// 4. Publish MQTT alarm event for live UI
			if mqttClient != nil && mqttClient.IsConnected() {
				ev := map[string]interface{}{
					"id":           alarmID,
					"nodeId":       s.nodeID,
					"orgId":        s.orgID,
					"departmentId": nullableStr(s.departmentID),
					"paramKey":     "online",
					"paramLabel":   "Device Offline",
					"severity":     "CRITICAL",
					"kind":         "offline",
					"value":        0,
					"threshold":    0,
					"unit":         "",
					"ts":           time.Now().UnixMilli(),
				}
				evBytes, _ := json.Marshal(ev)
				dispOrg := s.orgID
				if dispOrg == "" {
					dispOrg = "default"
				}
				mqttClient.Publish(fmt.Sprintf("internal/alarms/live/%s/%s", dispOrg, s.nodeID), 0, false, evBytes)
			}
		}
	}
}

// startHealthServer serves Kubernetes liveness (/healthz) and readiness (/readyz) probes.
func startHealthServer(port string) {
	mux := http.NewServeMux()

	// Liveness probe: verifies process responsiveness & active telemetry flow.
	// If the worker has received NO telemetry for > 5 minutes (and running > 3 minutes),
	// it reports 503 so Kubernetes automatically restarts the pod (Self-Healing).
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		connected := mqttClient != nil && mqttClient.IsConnected()
		lastMs := lastTelemetryUnix.Load()
		uptime := time.Since(startTime)

		// 1. Check if completely disconnected for > 1 minute
		if !connected && uptime > 1*time.Minute {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]any{
				"status":         "unhealthy",
				"reason":         "mqtt_disconnected",
				"mqtt_connected": false,
				"uptime":         uptime.Round(time.Second).String(),
			})
			return
		}

		// 2. Check for stale telemetry (silent deadlock / stalled subscription)
		if uptime > 3*time.Minute {
			var idle time.Duration
			if lastMs == 0 {
				idle = uptime
			} else {
				idle = time.Since(time.Unix(lastMs, 0))
			}

			// If no telemetry received for > 5 minutes, declare pod unhealthy for K8s restart
			if idle > 5*time.Minute {
				w.WriteHeader(http.StatusServiceUnavailable)
				json.NewEncoder(w).Encode(map[string]any{
					"status":         "unhealthy",
					"reason":         "stale_telemetry",
					"idle_duration":  idle.Round(time.Second).String(),
					"mqtt_connected": connected,
					"uptime":         uptime.Round(time.Second).String(),
				})
				return
			}
		}

		lastAge := "never"
		if lastMs > 0 {
			lastAge = time.Since(time.Unix(lastMs, 0)).Round(time.Second).String()
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"status":         "ok",
			"mqtt_connected": connected,
			"last_telemetry": lastAge,
			"uptime":         uptime.Round(time.Second).String(),
		})
	})

	// Readiness probe: verifies control database ping & broker readiness
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if controlDB == nil || controlDB.Ping() != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte("database not reachable"))
			return
		}
		if mqttClient != nil && !mqttClient.IsConnected() && time.Since(startTime) > 30*time.Second {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte("mqtt not connected"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ready"))
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	log.Printf("[health] Health server listening on :%s (/healthz, /readyz)", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("[health] Health server error: %v", err)
	}
}

// heartbeatLoop prints one line per window so an operator can tell a healthy but
// quiet worker from a stalled one, and can see ingest volume at a glance.
func heartbeatLoop() {
	const window = 5 * time.Minute
	for range time.Tick(window) {
		devices := 0
		statDevices.Range(func(k, _ any) bool { devices++; statDevices.Delete(k); return true })
		lastMs := lastTelemetryUnix.Load()
		lastAge := "never"
		if lastMs > 0 {
			lastAge = time.Since(time.Unix(lastMs, 0)).Round(time.Second).String()
		}
		log.Printf("ingest %s: %d readings, %d presence, %d dropped, %d errors, %d identity-mismatch, %d identity-conflict, %d clock-skew, %d device(s) [mqtt_connected=%v, identity=%s, last_telemetry=%s]",
			window, statReadings.Swap(0), statPresence.Swap(0), statDropped.Swap(0), statErrors.Swap(0),
			statIdentityRejected.Swap(0), statIdentityConflicts.Swap(0), statClockRejected.Swap(0), devices,
			mqttClient != nil && mqttClient.IsConnected(),
			map[bool]string{true: "enforce", false: "warn"}[identityEnforced()], lastAge)
	}
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

	// Legacy organizations, and the unclaimed pool, keep using the control DB
	// instead of a tenant DB. UnassignedOrg is a sentinel, not a real org with
	// its own database — autoRegisterPending always writes these nodes into
	// controlDB.nodes, regardless of tenantMode — so resolving it to a tenant
	// pool would try to open "iothub_unassigned", a database that never
	// exists, on every single frame from a not-yet-claimed device.
	if orgID == "org-1" || orgID == "org-2" || orgID == "org-3" || orgID == UnassignedOrg {
		return controlDB
	}

	// Check cache
	if db, ok := tenantDBs.Load(orgID); ok {
		return db.(*sql.DB)
	}

	// Create new connection pool for this tenant
	dbName := orgDbName(orgID)

	db, err := openDB(dbName)
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
// nodes.merge_into is added by migrate-v20. Until the migration Job runs, every
// query naming it fails — so the column is treated as optional and re-probed
// periodically rather than assumed, and the worker keeps ingesting either way.
var mergeIntoMissingUntil atomic.Int64

func mergeIntoOK() bool { return time.Now().UnixMilli() >= mergeIntoMissingUntil.Load() }

func noteMergeIntoMissing() {
	if mergeIntoOK() {
		log.Printf("nodes.merge_into is missing (migrate-v20 not applied yet) — multi-topic device merging is off until it is")
	}
	mergeIntoMissingUntil.Store(time.Now().Add(5 * time.Minute).UnixMilli())
}

func nodeInfo(nodeID string) (orgID, depID, status, mergeInto string) {
	if cached, ok := nodeToOrg.Load(nodeID); ok {
		entry := cached.(OrgCacheEntry)
		if time.Now().Before(entry.ExpiresAt) {
			return entry.OrgID, entry.DepartmentID, entry.Status, entry.MergeInto
		}
	}

	var org, dep, st, mi sql.NullString
	var err error
	// merge_into arrives with migrate-v20, and the flow/worker image rolls
	// independently of the migration Job. Selecting it unconditionally made
	// EVERY frame fail resolution during that window — which reads as "unknown
	// node", so telemetry was auto-registered as pending and dropped for the
	// whole fleet. Fall back to the pre-v20 shape and retry the full one later,
	// so ingest survives the gap and picks the column up without a restart.
	if mergeIntoOK() {
		err = controlDB.QueryRow("SELECT org_id, department_id, status, merge_into FROM nodes WHERE id=?", nodeID).Scan(&org, &dep, &st, &mi)
		if err != nil && strings.Contains(err.Error(), "merge_into") {
			noteMergeIntoMissing()
			err = controlDB.QueryRow("SELECT org_id, department_id, status FROM nodes WHERE id=?", nodeID).Scan(&org, &dep, &st)
		}
	} else {
		err = controlDB.QueryRow("SELECT org_id, department_id, status FROM nodes WHERE id=?", nodeID).Scan(&org, &dep, &st)
	}
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("Error resolving node %s: %v", nodeID, err)
		}
		return "", "", "", "" // unknown → caller auto-registers as pending
	}

	nodeToOrg.Store(nodeID, OrgCacheEntry{
		OrgID:        org.String,
		DepartmentID: dep.String,
		Status:       st.String,
		MergeInto:    mi.String,
		ExpiresAt:    time.Now().Add(2 * time.Minute),
	})
	return org.String, dep.String, st.String, mi.String
}

// resolveFeed follows nodes.merge_into once: a transformer split across an
// electrical and an environmental topic publishes under two node ids, and the
// secondary's readings belong to the primary. Returns the node everything
// downstream (presence, readings, alarms) should be attributed to, plus that
// node's org/department/status — approval and tenancy follow the PRIMARY, since
// that is the device an admin actually approved.
//
// Deliberately one hop and never through a missing primary: a chain, a self
// reference or a dangling target falls back to the publishing node, so a
// mis-set column can hide data from the fleet but can never discard it.
func resolveFeed(nodeID string) (target, orgID, depID, status string) {
	org, dep, st, mergeInto := nodeInfo(nodeID)
	if mergeInto == "" || mergeInto == nodeID {
		return nodeID, org, dep, st
	}
	pOrg, pDep, pStatus, _ := nodeInfo(mergeInto)
	if pOrg == "" {
		log.Printf("merge_into target %q for node %q does not exist — keeping readings on %s", mergeInto, nodeID, nodeID)
		return nodeID, org, dep, st
	}
	return mergeInto, pOrg, pDep, pStatus
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
	case "automobile", "ev", "formula", "nat", "nat-gw":
		return "automobile"
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

// reclaimOrphan moves a PENDING device out of the unassigned pool once its
// topic names a real, active org. autoRegisterPending only ever runs on a
// node's genuinely first frame — it is an INSERT IGNORE, and nothing else
// re-reads the topic for a node that already has a row. Without this, a
// device that published once with a wrong or not-yet-existing org segment
// (a test before the org existed, the wrong id typo'd once) stays pinned to
// UnassignedOrg forever: nodeInfo() returns that literal string, never "",
// so the auto-register path in handleTelemetry never runs again for it no
// matter how correct the firmware becomes. Only a superadmin claiming the
// orphan by hand would ever move it — which defeats the entire point of
// telling an org admin "update your firmware to the topic shown" if the
// device already made one bad publish before they did.
//
// Scoped strictly to status='pending' AND org_id=UnassignedOrg in the UPDATE
// itself (not just the caller's intent) so a spoofed topic can never move an
// already-APPROVED device into another org.
func reclaimOrphan(nodeID, topic string) {
	parts := strings.Split(topic, "/")
	if len(parts) < 2 {
		return
	}
	orgID := parts[1]
	if orgID == "" || orgID == UnassignedOrg || !orgExists(orgID) {
		return
	}
	product := ""
	if len(parts) >= 3 {
		product = parts[2]
	}
	prefix := topic
	if len(parts) >= 4 {
		prefix = strings.Join(parts[:4], "/")
	}
	res, err := controlDB.Exec(
		"UPDATE nodes SET org_id=?, domain=?, mqtt_prefix=? WHERE id=? AND status='pending' AND org_id=?",
		orgID, domainFromProduct(product), prefix, nodeID, UnassignedOrg)
	if err != nil {
		log.Printf("reclaimOrphan failed for node %s: %v", nodeID, err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		// The 2-minute nodeInfo cache would otherwise keep answering
		// UnassignedOrg for whatever is left of its TTL.
		nodeToOrg.Delete(nodeID)
		log.Printf("Reclaimed orphan node %s -> org=%s (topic now names an active org)", nodeID, orgID)
	}
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
	var wasOffline bool
	var wasOnline bool
	var downFor time.Duration
	var prev sql.NullInt64
	var lastSeen sql.NullTime
	var lastReadingAt sql.NullTime
	var lastUptime sql.NullInt64
	var uptimeRegressions sql.NullInt64
	var uptimeWindowStart sql.NullTime
	var identityConflictAt sql.NullTime

	if err := controlDB.QueryRow(
		"SELECT online, last_seen, last_reading_at, last_uptime, uptime_regressions, uptime_window_start, identity_conflict_at "+
			"FROM device_presence WHERE node_id = ?", t.NodeID,
	).Scan(&prev, &lastSeen, &lastReadingAt, &lastUptime, &uptimeRegressions, &uptimeWindowStart, &identityConflictAt); err == nil {
		wasOffline = prev.Valid && prev.Int64 == 0
		wasOnline = prev.Valid && prev.Int64 == 1
		if online == 1 && wasOffline && lastSeen.Valid {
			downFor = time.Since(lastSeen.Time).Round(time.Second)
		}
	} else if strings.Contains(err.Error(), "last_uptime") {
		if errLegacy := controlDB.QueryRow(
			"SELECT online, last_seen, last_reading_at FROM device_presence WHERE node_id = ?", t.NodeID,
		).Scan(&prev, &lastSeen, &lastReadingAt); errLegacy == nil {
			wasOffline = prev.Valid && prev.Int64 == 0
			wasOnline = prev.Valid && prev.Int64 == 1
			if online == 1 && wasOffline && lastSeen.Valid {
				downFor = time.Since(lastSeen.Time).Round(time.Second)
			}
		}
	}

	// ── Two devices under one node id? ───────────────────────────────────────
	// Only frames that actually carry an uptime participate; firmware that
	// never sends one simply never contributes evidence either way.
	var uptimeOut, regressionsOut interface{}
	var windowStartOut interface{}
	var flagConflict bool
	if t.Uptime != nil {
		var prevUptime *int64
		if lastUptime.Valid {
			v := lastUptime.Int64
			prevUptime = &v
		}
		var windowStart *time.Time
		if uptimeWindowStart.Valid {
			w := uptimeWindowStart.Time
			windowStart = &w
		}
		grace := false
		// Only worth the query when there is actually a backwards jump to explain.
		if prevUptime != nil && *t.Uptime < *prevUptime {
			grace = recentOtaReboot(t.NodeID)
		}
		nextRegressions, nextWindow, flagged := noteUptime(
			prevUptime, *t.Uptime, int(uptimeRegressions.Int64), windowStart, time.Now(), grace)
		uptimeOut, regressionsOut, windowStartOut = *t.Uptime, nextRegressions, nextWindow
		// Flag once per episode: an already-flagged node keeps its original
		// timestamp so "since when" is not reset by every further frame.
		flagConflict = flagged && !identityConflictAt.Valid
		if flagConflict {
			statIdentityConflicts.Add(1)
			macHint := ""
			if t.MAC != "" {
				macHint = fmt.Sprintf(" (reporting MAC %s)", t.MAC)
			}
			log.Printf("IDENTITY CONFLICT %s%s: uptime went backwards %d times in %s "+
				"(two devices publishing under this id, or one boot-looping) — flagged for admin review",
				t.NodeID, macHint, nextRegressions, uptimeRegressionWindow)
		}
	}
	// A merged pair (nodes.merge_into, resolveFeed) shares ONE presence row
	// between two MQTT topics — "the transformer stays online while EITHER
	// topic is publishing" is the whole reason to merge them; a box sensor's
	// WiFi dropping is a link event on one half of the physical asset, not the
	// asset itself going dark. But an LWT/offline status frame from either
	// topic reaches this function, and unguarded it flips the SHARED row to
	// offline even while the OTHER topic's readings are landing every second —
	// a flaky secondary radio then raises repeated CRITICAL "Device Offline"
	// alarms and LINK_LOST/LINK_RESTORE pairs for a device whose telemetry
	// never actually stopped.
	//
	// last_reading_at is the more trustworthy signal: it only advances when a
	// reading was actually stored, from either merged topic, so an offline
	// claim arriving while it is still fresh is outvoted rather than trusted.
	// A device that has genuinely gone dark stops producing readings too, so
	// this only suppresses exactly the spurious case.
	if online == 0 && lastReadingAt.Valid && time.Since(lastReadingAt.Time) < presenceOverrideWindow {
		online = 1
	}
	// A device announcing its own outage (LWT / deep sleep) is worth a line too:
	// without it the log only ever showed recoveries, so a flapping link looked
	// like repeated "back online" with no cause and no measurable downtime.
	if online == 0 {
		log.Printf("Device reported offline: %s (state=%q)", t.NodeID, t.State)
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
	// identity_conflict_at is set only on the frame that crosses the threshold
	// and is otherwise left untouched — COALESCE keeps an existing flag (and
	// its original timestamp) until an admin clears it, and NULL on a normal
	// frame never clears one.
	var conflictOut interface{}
	if flagConflict {
		conflictOut = time.Now()
	}
	if _, err := controlDB.Exec(
		"INSERT INTO device_presence (node_id, online, last_seen, rssi, batt, fw, last_uptime, uptime_regressions, uptime_window_start, identity_conflict_at) "+
			"VALUES (?, ?, NOW(3), ?, ?, ?, ?, COALESCE(?,0), ?, ?) "+
			"ON DUPLICATE KEY UPDATE online=VALUES(online), last_seen=VALUES(last_seen), "+
			"rssi=COALESCE(VALUES(rssi),rssi), batt=COALESCE(VALUES(batt),batt), fw=COALESCE(VALUES(fw),fw), "+
			"last_uptime=COALESCE(VALUES(last_uptime),last_uptime), "+
			"uptime_regressions=COALESCE(VALUES(uptime_regressions),uptime_regressions), "+
			"uptime_window_start=COALESCE(VALUES(uptime_window_start),uptime_window_start), "+
			"identity_conflict_at=COALESCE(identity_conflict_at,VALUES(identity_conflict_at))",
		t.NodeID, online, rssi, batt, fw, uptimeOut, regressionsOut, windowStartOut, conflictOut); err != nil {
		if strings.Contains(err.Error(), "last_uptime") {
			// Fallback for databases where migrate-v51 has not been applied yet
			if _, fErr := controlDB.Exec(
				"INSERT INTO device_presence (node_id, online, last_seen, rssi, batt, fw) "+
					"VALUES (?, ?, NOW(3), ?, ?, ?) "+
					"ON DUPLICATE KEY UPDATE online=VALUES(online), last_seen=VALUES(last_seen), "+
					"rssi=COALESCE(VALUES(rssi),rssi), batt=COALESCE(VALUES(batt),batt), fw=COALESCE(VALUES(fw),fw)",
				t.NodeID, online, rssi, batt, fw); fErr != nil {
				log.Printf("Presence update failed for %s: %v", t.NodeID, fErr)
				return
			}
		} else {
			log.Printf("Presence update failed for %s: %v", t.NodeID, err)
			return
		}
	}
	// online == 1 matters as much as wasOffline. A device that is already marked
	// offline still delivers its retained/late LWT ("state":"offline"), and
	// treating that as a recovery wrote a bogus LINK_RESTORE and cleared the open
	// offline alarm — the timeline claimed "Link none → wifi (recovered)" at the
	// exact second the device announced it was gone, and the log printed
	// "Device reported offline" and "Device back online" one after the other.
	if wasOffline && online == 1 {
		// from_transport 'none' is what the transport endpoint maps to
		// LINK_RESTORE, so "device is back" sits next to the outage entry.
		transport := t.Transport
		if transport == "" {
			transport = "wifi"
		}

		var orgID string
		var depID sql.NullString
		if err := controlDB.QueryRow("SELECT org_id, department_id FROM nodes WHERE id = ?", t.NodeID).Scan(&orgID, &depID); err == nil {
			targetDB := resolvePool(orgID)
			if targetDB == nil {
				targetDB = controlDB
			}
			if _, err := targetDB.Exec(
				"INSERT INTO transport_events (node_id, from_transport, to_transport, reason, rssi, ts) VALUES (?,?,?,?,?,NOW(3))",
				t.NodeID, "none", transport, "recovered", rssi); err != nil {
				log.Printf("Recovery event failed for %s: %v", t.NodeID, err)
			}
			// Close the open offline alarm in tenant DB so the device stops looking down.
			if _, err := targetDB.Exec(
				"UPDATE alarm_events SET cleared_at = NOW(3) WHERE node_id = ? AND kind = 'offline' AND cleared_at IS NULL",
				t.NodeID); err != nil {
				log.Printf("Clear offline alarm failed for %s: %v", t.NodeID, err)
			}
		} else {
			// Unassigned fallback to controlDB
			_, _ = controlDB.Exec(
				"INSERT INTO transport_events (node_id, from_transport, to_transport, reason, rssi, ts) VALUES (?,?,?,?,?,NOW(3))",
				t.NodeID, "none", transport, "recovered", rssi)
			_, _ = controlDB.Exec(
				"UPDATE alarm_events SET cleared_at = NOW(3) WHERE node_id = ? AND kind = 'offline' AND cleared_at IS NULL",
				t.NodeID)
		}

		if downFor > 0 {
			log.Printf("Device back online: %s (was down %s)", t.NodeID, downFor)
		} else {
			log.Printf("Device back online: %s", t.NodeID)
		}
	} else if online == 0 && wasOnline {
		// Log LINK_LOST because of LWT or graceful disconnect
		transport := t.Transport
		if transport == "" {
			transport = "wifi"
		}

		var orgID string
		var depID sql.NullString
		if err := controlDB.QueryRow("SELECT org_id, department_id FROM nodes WHERE id = ?", t.NodeID).Scan(&orgID, &depID); err == nil {
			targetDB := resolvePool(orgID)
			if targetDB == nil {
				targetDB = controlDB
			}
			if _, err := targetDB.Exec(
				"INSERT INTO transport_events (node_id, from_transport, to_transport, reason, rssi, ts) VALUES (?,?,?,?,?,NOW(3))",
				t.NodeID, transport, "none", "lwt", rssi); err != nil {
				log.Printf("Link lost event failed for %s: %v", t.NodeID, err)
			}

			alarmID := fmt.Sprintf("ev-offline-%s-%d", t.NodeID, time.Now().UnixMilli())
			_, err := targetDB.Exec("INSERT IGNORE INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,value,threshold,unit,raised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(3))",
				alarmID, t.NodeID, orgID, nullableStr(depID), "online", "Device Offline", "CRITICAL", "offline", 0, 0, "")
			if err != nil {
				log.Printf("Insert offline alarm failed for %s: %v", t.NodeID, err)
			}
		} else {
			// Unassigned fallback to controlDB
			_, _ = controlDB.Exec(
				"INSERT INTO transport_events (node_id, from_transport, to_transport, reason, rssi, ts) VALUES (?,?,?,?,?,NOW(3))",
				t.NodeID, transport, "none", "lwt", rssi)
			alarmID := fmt.Sprintf("ev-offline-%s-%d", t.NodeID, time.Now().UnixMilli())
			_, _ = controlDB.Exec("INSERT IGNORE INTO alarm_events (id,node_id,org_id,department_id,param_key,param_label,severity,kind,value,threshold,unit,raised_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(3))",
				alarmID, t.NodeID, UnassignedOrg, nil, "online", "Device Offline", "CRITICAL", "offline", 0, 0, "")
		}
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
	err := tenantDB.QueryRow("SELECT node_id, org_id, domain, rule_json, debounce_json FROM alarm_rules WHERE node_id=?", nodeID).
		Scan(&r.NodeID, &r.OrgID, &r.Domain, &r.RuleJSON, &r.DebounceJSON)
	if err != nil && strings.Contains(err.Error(), "debounce_json") {
		// Fallback if debounce_json column is not present
		err = tenantDB.QueryRow("SELECT node_id, org_id, domain, rule_json FROM alarm_rules WHERE node_id=?", nodeID).
			Scan(&r.NodeID, &r.OrgID, &r.Domain, &r.RuleJSON)
	}

	if err != nil {
		if err != sql.ErrNoRows {
			// This is normal if the device has no alarm rule configured
			// log.Printf("Error fetching alarm rule for node %s: %v", nodeID, err)
		}
		return AlarmRule{}, false
	}

	rulesCache.Store(nodeID, RuleCacheEntry{
		Rule:      r,
		ExpiresAt: time.Now().Add(30 * time.Second),
	})
	return r, true
}

func getPersonalRules(tenantDB *sql.DB, nodeID string) []PersonalRule {
	if cached, ok := personalRulesCache.Load(nodeID); ok {
		entry := cached.(PersonalRulesCacheEntry)
		if time.Now().Before(entry.ExpiresAt) {
			return entry.Rules
		}
	}

	var rows *sql.Rows
	var err error
	if tenantDB != nil {
		rows, err = tenantDB.Query("SELECT user_id, domain, rule_json FROM user_node_rules WHERE node_id=?", nodeID)
	}
	if (err != nil || rows == nil) && controlDB != nil && controlDB != tenantDB {
		rows, err = controlDB.Query("SELECT user_id, domain, rule_json FROM user_node_rules WHERE node_id=?", nodeID)
	}
	if err != nil || rows == nil {
		return nil
	}
	defer rows.Close()

	var out []PersonalRule
	for rows.Next() {
		var pr PersonalRule
		if err := rows.Scan(&pr.UserID, &pr.Domain, &pr.RuleJSON); err != nil {
			continue
		}
		out = append(out, pr)
	}

	personalRulesCache.Store(nodeID, PersonalRulesCacheEntry{
		Rules:     out,
		ExpiresAt: time.Now().Add(5 * time.Second),
	})
	return out
}

// rateWindow reads the time base a rate-of-rise alarm declares in its own unit
// string ('ppm/day' for DGA gassing, '°C/h' for thermal). Returns 0 when the
// unit carries no interpretable denominator, in which case the caller SKIPS the
// rate check rather than guessing — the previous code silently treated whatever
// the denominator said as if it meant "per sample".
func rateWindow(unit string) time.Duration {
	u := strings.ToLower(strings.TrimSpace(unit))
	i := strings.LastIndex(u, "/")
	if i < 0 {
		return 0
	}
	switch strings.TrimSpace(u[i+1:]) {
	case "day", "d":
		return 24 * time.Hour
	case "hour", "hr", "h":
		return time.Hour
	case "min", "minute":
		return time.Minute
	case "sec", "second", "s":
		return time.Second
	}
	return 0
}

// Two samples close together turn sensor jitter into a huge extrapolated rate:
// 0.1 ppm of noise across 1 second is 8,640 ppm/day. Requiring at least
// window/rateMinDivisor between the compared samples caps that amplification
// at 24x — an hour for a /day rate, 2.5 minutes for a /h rate.
const rateMinDivisor = 24

// ── Duplicate-identity detection via uptime ────────────────────────────────
//
// A device's uptime only ever climbs. It jumps BACKWARDS exactly once when
// that device reboots — and repeatedly when two boards are alternating under
// one node id, because each frame reports its own board's uptime. So the
// count inside a window, not any single jump, is what separates the two.
//
// Two boards on a 30s heartbeat regress on roughly every other frame: ~15
// inside this window. A device that rebooted regresses once. A device stuck
// in a boot loop also regresses repeatedly — which is equally worth an
// operator's attention, so the flag is named for the evidence (uptime went
// backwards repeatedly) rather than asserting which of the two it is.
const (
	uptimeRegressionWindow    = 15 * time.Minute
	uptimeRegressionThreshold = 3
	// A backwards jump within this long after an OTA deployment started is the
	// reboot that OTA asked for, so it is not counted at all.
	uptimeOtaGrace = 30 * time.Minute
)

// recentOtaReboot reports whether an OTA deployment for this node could
// explain a reboot right now — checked before counting a regression so a
// fleet-wide firmware rollout does not flag every device it touches.
func recentOtaReboot(nodeID string) bool {
	var n int
	if err := controlDB.QueryRow(
		"SELECT COUNT(*) FROM ota_deployments WHERE node_id=? AND started_at >= (NOW(3) - INTERVAL ? SECOND)",
		nodeID, int(uptimeOtaGrace.Seconds())).Scan(&n); err != nil {
		// Table missing (pre-v9) or unreachable: do not let a diagnostic query
		// decide whether telemetry is trusted. Assume no OTA and carry on.
		return false
	}
	return n > 0
}

// noteUptime folds one reported uptime into the node's regression state and
// returns the columns to write. Pure apart from the OTA lookup, so the whole
// rule is testable without a database — see e2e/proofs/go-identity-proof.go.
//
// prevUptime/regressions/windowStart are this node's stored state; `now` is
// the frame's arrival time.
func noteUptime(prevUptime *int64, reported int64, regressions int, windowStart *time.Time, now time.Time, otaGrace bool) (nextRegressions int, nextWindowStart time.Time, flagged bool) {
	// First uptime ever seen, or no backwards jump: nothing to count. The
	// window is left running so unrelated regressions minutes apart still
	// accumulate toward the threshold.
	if prevUptime == nil || reported >= *prevUptime {
		if windowStart == nil {
			return regressions, now, false
		}
		return regressions, *windowStart, false
	}
	if otaGrace {
		if windowStart == nil {
			return regressions, now, false
		}
		return regressions, *windowStart, false
	}
	// A regression. Start a fresh window if there is none or the old one has
	// expired, so counts never carry across unrelated weeks.
	if windowStart == nil || now.Sub(*windowStart) > uptimeRegressionWindow {
		return 1, now, false
	}
	next := regressions + 1
	return next, *windowStart, next >= uptimeRegressionThreshold
}

// rateWindowFor is 0 when the param has no rate rule at all, or when its unit
// has no interpretable time base — both mean "no rate check".
func rateWindowFor(p RuleParam) time.Duration {
	if p.Rate == nil {
		return 0
	}
	return rateWindow(p.Rate.Unit)
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

// evaluateParams runs the dwell/hysteresis/rate state machine for one rule's
// params against ns, calling emit for each threshold or rate breach that
// clears dwell/cooldown. Shared by the org-wide rule (evaluateAlarms) and
// each user's personal rule (evaluatePersonalAlarms) — same state machine,
// applied to a caller-supplied (and differently-keyed) *AlarmNodeState, so
// the two can never read or clobber each other's state.
func evaluateParams(ns *AlarmNodeState, ruleDef RuleDefinition, debounceMap map[string]ParamDebounce, t TelemetryPayload, ts time.Time, emit func(p RuleParam, sev, kind string, val, thresh float64)) {
	ns.Mu.Lock()
	defer ns.Mu.Unlock()

	for _, p := range ruleDef.Params {
		if p.Enabled != nil && !*p.Enabled {
			continue
		}
		val, exists := t.Values[p.Key]
		if !exists {
			continue
		}

		// A single physical reading can carry two independent bands sharing
		// one Key — a phase voltage alarms both 'high' (over-voltage) and
		// 'low' (under-voltage) — as two separate RuleDefinition.Params
		// entries. ns.Params used to be keyed by p.Key alone: with two such
		// entries, both fetched/created the SAME *AlarmParamState, so
		// whichever one ran second in this loop overwrote the ActiveLevel
		// the other had just set. Proved with the real state machine: a
		// steady 255V over-voltage reading raised CRITICAL once, then the
		// paired under-voltage entry (same Key, opposite Direction) cleared
		// that ActiveLevel back to "" on the very same frame, causing the
		// over-voltage entry to re-raise an identical CRITICAL event on
		// EVERY subsequent frame the voltage held steady — a duplicate-alarm
		// storm, not just a missed one. Keying by (Key, Direction) gives each
		// band its own dwell/hysteresis/PrevValue state, matching how
		// evalParam in alarmEngine.ts and the Node-RED backend already keep
		// per-param-entry local state rather than a shared map.
		stateKey := p.Key + "\x1f" + p.Direction
		ps, ok := ns.Params[stateKey]
		if !ok {
			ps = &AlarmParamState{}
			ns.Params[stateKey] = ps
		}

		// Rate Check — change per unit time, in the SAME unit the rule
		// declares, so a 'ppm/day' limit is compared against an actual
		// ppm/day figure instead of a raw frame-to-frame delta.
		if rateWin := rateWindowFor(p); rateWin > 0 {
			if ps.PrevValue == nil {
				valCopy := val
				ps.PrevValue = &valCopy
				ps.PrevValueTs = ts
			} else if ts.Before(ps.PrevValueTs) {
				// The anchor is NEWER than this frame. Two ways that happens: a
				// device flushing an offline backlog replays older frames, or a
				// bad clock stamped the anchor into the future.
				//
				// Either way the anchor is unusable — every elapsed against it
				// is negative, so it fails the minimum-span test below, and the
				// branch that advances the anchor is the same one that never
				// runs. Rate-of-rise then stayed dead for this parameter until
				// the worker restarted. Re-anchoring here costs one rate window
				// of coverage instead of all of it.
				valCopy := val
				ps.PrevValue = &valCopy
				ps.PrevValueTs = ts
			} else if elapsed := ts.Sub(ps.PrevValueTs); elapsed >= rateWin/rateMinDivisor {
				delta := val - *ps.PrevValue
				if p.Direction != "high" {
					delta = *ps.PrevValue - val
				}
				d := delta * float64(rateWin) / float64(elapsed)
				if d >= p.Rate.Warn {
					emit(p, "WARNING", "rate", val, p.Rate.Warn)
				}
				valCopy := val
				ps.PrevValue = &valCopy
				ps.PrevValueTs = ts
			}
			// Below the minimum elapsed time the anchor is deliberately left
			// where it is: advancing it every frame is what made the old
			// version measure over one sampling interval instead of a real span.
		}

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
		cooldownS := 0
		if dbOpt, ok := debounceMap[p.Key]; ok {
			if dbOpt.DwellMin != nil && *dbOpt.DwellMin > 0 {
				dwellMin = *dbOpt.DwellMin
			}
			if dbOpt.CooldownS != nil && *dbOpt.CooldownS > 0 {
				cooldownS = *dbOpt.CooldownS
			}
		}

		if lvl != "" {
			ps.RunCount++
			if ps.RunCount >= dwellMin && lvl != ps.ActiveLevel {
				inCooldown := false
				if cooldownS > 0 && !ps.LastRaisedAt.IsZero() && ts.Sub(ps.LastRaisedAt) < time.Duration(cooldownS)*time.Second {
					inCooldown = true
				}
				if !inCooldown && (ps.ActiveLevel == "" || (ps.ActiveLevel == "WARNING" && lvl == "CRITICAL")) {
					thresh := p.Warn
					if lvl == "CRITICAL" {
						thresh = p.Critical
					}
					emit(p, lvl, "threshold", val, thresh)
					ps.LastRaisedAt = ts
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

func evaluateAlarms(tenantDB *sql.DB, client mqtt.Client, orgID, depID string, t TelemetryPayload, ts time.Time, rule AlarmRule) {
	var ruleDef RuleDefinition
	if err := json.Unmarshal([]byte(rule.RuleJSON), &ruleDef); err != nil {
		log.Printf("Failed to unmarshal rule JSON for node %s: %v", t.NodeID, err)
		return
	}

	// Parse debounce_json if available
	debounceMap := make(map[string]ParamDebounce)
	if rule.DebounceJSON.Valid && len(rule.DebounceJSON.String) > 0 {
		_ = json.Unmarshal([]byte(rule.DebounceJSON.String), &debounceMap)
	}

	stateVal, _ := alarmStateCache.LoadOrStore(t.NodeID, &AlarmNodeState{
		Params: make(map[string]*AlarmParamState),
	})
	ns := stateVal.(*AlarmNodeState)

	evaluateParams(ns, ruleDef, debounceMap, t, ts, func(p RuleParam, sev, kind string, val, thresh float64) {
		emitAlarm(tenantDB, client, orgID, depID, t, ts, p, sev, kind, val, thresh, rule.Domain)
	})
}

// evaluatePersonalAlarms runs every user's own personal rule for this node
// against the same telemetry frame the shared rule just saw — independently:
// no alarm_events row, no shared-state interaction, delivered on a separate
// MQTT topic Node-RED's notify path never mixes into the org/department
// broadcast. Opt-in and normally a no-op (getPersonalRules returns nil for
// the common case of zero personal rules on this node).
func evaluatePersonalAlarms(client mqtt.Client, orgID string, t TelemetryPayload, ts time.Time, rules []PersonalRule) {
	for _, pr := range rules {
		var ruleDef RuleDefinition
		if err := json.Unmarshal([]byte(pr.RuleJSON), &ruleDef); err != nil {
			log.Printf("Failed to unmarshal personal rule JSON for node %s user %s: %v", t.NodeID, pr.UserID, err)
			continue
		}
		if ruleDef.DwellMin <= 0 {
			ruleDef.DwellMin = 1
		}

		stateKey := pr.UserID + "\x1f" + t.NodeID
		stateVal, _ := personalAlarmStateCache.LoadOrStore(stateKey, &AlarmNodeState{
			Params: make(map[string]*AlarmParamState),
		})
		ns := stateVal.(*AlarmNodeState)

		userID := pr.UserID
		domain := pr.Domain
		evaluateParams(ns, ruleDef, map[string]ParamDebounce{}, t, ts, func(p RuleParam, sev, kind string, val, thresh float64) {
			emitPersonalAlarm(client, orgID, userID, t, ts, p, sev, kind, val, thresh, domain)
		})
	}
}

func emitAlarm(tenantDB *sql.DB, client mqtt.Client, orgID, depID string, t TelemetryPayload, ts time.Time, p RuleParam, sev, kind string, val, thresh float64, domain string) {
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

	// Publish WebSocket Enrichment Event. domain lets notifyFunc (Node-RED)
	// pick a domain-specific risk description — carbonNode and bloodBox both
	// use the canonical param keys tempHigh/tempLow/door/current, so without
	// it an alarm email/LINE message for either would have to pick one
	// domain's wording for both, or (as it was before this field existed)
	// fall back to a generic "Parameter limit breached" for both, silently.
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
		"domain":       domain,
	}

	evBytes, _ := json.Marshal(ev)

	dispOrg := orgID
	if dispOrg == "" {
		dispOrg = "default"
	}
	client.Publish(fmt.Sprintf("internal/alarms/live/%s/%s", dispOrg, t.NodeID), 0, false, evBytes)
}

// emitPersonalAlarm publishes ONE user's own breach — no alarm_events INSERT
// (a personal threshold must never appear anywhere admins/everyone else
// sees), and a topic distinct from internal/alarms/live so Node-RED's
// org/department storm-batch and broadcast never mix a personal breach into
// the shared alarm feed. personalUserId is who this is for; Node-RED's
// notifyPersonal reads it, looks up that one user's own Delivery Channels
// (user_prefs.alertChannels[nodeId] — the same toggle MyAlertSettings
// Section 1 already writes), and sends only to them.
func emitPersonalAlarm(client mqtt.Client, orgID, userID string, t TelemetryPayload, ts time.Time, p RuleParam, sev, kind string, val, thresh float64, domain string) {
	id := fmt.Sprintf("pev-%s-%s-%s-%d-%s", userID, t.NodeID, p.Key, ts.UnixMilli(), kind)

	ev := map[string]interface{}{
		"id":             id,
		"nodeId":         t.NodeID,
		"orgId":          orgID,
		"personalUserId": userID,
		"paramKey":       p.Key,
		"paramLabel":     p.Label,
		"severity":       sev,
		"kind":           kind,
		"value":          val,
		"threshold":      thresh,
		"unit":           p.Unit,
		"ts":             ts.UnixMilli(),
		"domain":         domain,
	}

	evBytes, _ := json.Marshal(ev)

	dispOrg := orgID
	if dispOrg == "" {
		dispOrg = "default"
	}
	client.Publish(fmt.Sprintf("internal/alarms/personal/%s/%s/%s", dispOrg, t.NodeID, userID), 0, false, evBytes)
}

func handleTelemetry(client mqtt.Client, msg mqtt.Message) {
	lastTelemetryUnix.Store(time.Now().Unix())
	mqttConnected.Store(true)
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
	dropNullValues(payload, t.Values)

	// Accept device_id as an alias for nodeId (firmware status/heartbeat frames).
	t.NodeID = t.id()
	if t.NodeID == "" {
		log.Printf("Missing nodeId/device_id in telemetry payload")
		return
	}

	// ── Identity: the topic and the payload must name the SAME node ──────────
	// Checked against the PUBLISHING id, before resolveFeed redirects a merged
	// secondary onto its primary — a feed publishes on its own topic under its
	// own id, and it is that pairing the broker authorised.
	if claimed := topicNodeID(msg.Topic()); claimed != "" && claimed != t.NodeID {
		baseClaimed, macFromTopic := stripMacSuffix(claimed)
		// The TOPIC id is the only trustworthy half of this comparison: the EMQX
		// ACL pins publish to "telemetry/+/+/${clientid}", so the broker
		// authorised it. The payload id is whatever the frame says. Rewriting
		// identity to the payload therefore has to be justified, not assumed.
		//
		// Two guards on the MAC-suffix case:
		//
		//  1. Only topic-suffixed/payload-bare ("tr-221_246F28A1B2C3" publishing
		//     as "tr-221"), which is the case the suffix support exists for.
		//     The sibling case (topic "tr-221_MAC1", payload "tr-221_MAC2" —
		//     both stripping to "tr-221") let one provisioned device publish
		//     under a DIFFERENT provisioned device's id. That is impersonation
		//     between two real assets with no legitimate use, and it is exactly
		//     the "two devices on one nodeId" collision the slew-rate guard
		//     added in this same change exists to detect — accepting it here
		//     would have the worker authorising the condition it then alarms on.
		//
		//  2. The suffixed id must not itself be a REGISTERED node. If
		//     "tr-221_246F28A1B2C3" is an asset in its own right, it publishes
		//     as itself; letting it write into the separate asset "tr-221" is a
		//     cross-asset — and, since nodeInfo resolves the org from the id,
		//     potentially cross-TENANT — write by a legitimately provisioned
		//     device. nodeInfo is cached (2 min), so this costs no query on the
		//     hot path once warm.
		if baseClaimed != "" && baseClaimed == t.NodeID {
			if topicOrg, _, _, _ := nodeInfo(claimed); topicOrg != "" {
				statIdentityRejected.Add(1)
				log.Printf("Identity REJECTED: topic %q is a registered node in org %s and may not publish as %q",
					claimed, topicOrg, t.NodeID)
				if identityEnforced() {
					return
				}
			} else {
				// Topic appended a compact MAC suffix (e.g. topic "tr-221_246F28A1B2C3" vs payload "tr-221")
				claimed = t.NodeID
				if t.MAC == "" && macFromTopic != "" {
					t.MAC, _ = normalizeMAC(macFromTopic)
				}
			}
		} else {
			statIdentityRejected.Add(1)
			verb := "REJECTED"
			if !identityEnforced() {
				verb = "ALLOWED (MQTT_IDENTITY_ENFORCE=warn)"
			}
			log.Printf("Identity mismatch %s: topic %q names %q but payload claims %q",
				verb, msg.Topic(), claimed, t.NodeID)
			if identityEnforced() {
				return
			}
		}
	}
	if t.MAC != "" {
		canonical, _ := normalizeMAC(t.MAC)
		t.MAC = canonical
	}

	// A secondary feed is redirected to its primary BEFORE anything is recorded,
	// so presence, readings and alarms all describe the one physical asset. The
	// transformer stays online while EITHER of its topics is publishing, which is
	// what the operator means by "is it up" — the box sensor going quiet while the
	// power meter keeps reporting is a link-loss event on the same device, not a
	// second device disappearing.
	feedID := t.NodeID
	target, orgID, depID, status := resolveFeed(t.NodeID)
	t.NodeID = target

	// Always record presence (every frame means the device is online)
	updatePresence(t)
	statPresence.Add(1)
	statDevices.Store(t.NodeID, struct{}{})

	// Zero-touch onboarding: an unknown device is auto-registered as a PENDING
	// node (org from its topic) and awaits admin approval — its data is dropped
	// until approved. Registration always uses the PUBLISHING id: a feed has to
	// exist as its own row before an admin can point it at a primary, so this
	// is what surfaces the second topic on the approval screen in the first
	// place.
	//
	// Runs BEFORE the isPresence() gate below, on purpose: this used to sit
	// after it (and after the Kafka produce), so a device whose firmware sends
	// a birth/heartbeat frame before its first readings frame got a
	// device_presence row from updatePresence() above and NO nodes row —
	// "online" in the DB, invisible on admin/pending forever, since that page
	// is `SELECT ... FROM nodes ... WHERE status='pending'`. nodeInfo() (called
	// above via resolveFeed) already returns real values for any node ALREADY
	// in the table regardless of its status, so orgID=="" is true only on this
	// device's genuinely first frame — moving this earlier does not make it
	// re-run on every later presence frame.
	if orgID == "" {
		sample, _ := json.Marshal(t.Values)
		autoRegisterPending(feedID, msg.Topic(), sample)
		statDropped.Add(1)
		return
	}
	// The sticky-orphan case: this node already exists (orgID != ""), pinned
	// to UnassignedOrg from an earlier bad publish. Check on every frame
	// whether the topic NOW names a real org — see reclaimOrphan's own
	// comment for why nothing else in this file ever does.
	if orgID == UnassignedOrg && status == "pending" {
		reclaimOrphan(target, msg.Topic())
	}

	// Status (birth/LWT) and heartbeat frames carry no readings — stop here
	// instead of falling through the readings path.
	if t.isPresence() {
		return
	}

	ts := acceptTimestamp(t.NodeID, t.Timestamp)
	t.Timestamp = ts.UnixMilli()

	record := &kgo.Record{
		Topic: "telemetry-events",
		Key:   []byte(t.NodeID),
		Value: payload,
	}
	kafkaClient.Produce(context.Background(), record, nil)
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
		// Find the open batch first, then update it by primary key. The previous
		// "UPDATE ... ORDER BY ... LIMIT 1" form is fragile — it silently matched
		// nothing on some server configurations, which made the backlog entry
		// disappear entirely instead of merging. LEAST/GREATEST are guarded with
		// COALESCE so a row whose bounds were never set does not turn NULL.
		var batchID int64
		err := tenantDB.QueryRow(
			"SELECT id FROM offline_sync_log WHERE node_id = ? AND sync_at > (NOW(3) - INTERVAL ? SECOND) ORDER BY sync_at DESC LIMIT 1",
			t.NodeID, int(backlogBatchWindow.Seconds())).Scan(&batchID)
		affected := int64(0)
		if err == nil && batchID > 0 {
			if res, uerr := tenantDB.Exec(
				"UPDATE offline_sync_log SET records_count = records_count + 1, "+
					"oldest_ts = LEAST(COALESCE(oldest_ts, ?), ?), newest_ts = GREATEST(COALESCE(newest_ts, ?), ?), sync_at = NOW(3) WHERE id = ?",
				ts, ts, ts, ts, batchID); uerr == nil {
				affected, _ = res.RowsAffected()
			} else {
				log.Printf("offline_sync_log merge failed for %s: %v", t.NodeID, uerr)
			}
		}
		if affected == 0 {
			if _, err := tenantDB.Exec(
				"INSERT INTO offline_sync_log (node_id, records_count, oldest_ts, newest_ts) VALUES (?, 1, ?, ?)",
				t.NodeID, ts, ts); err != nil {
				log.Printf("Failed to insert offline_sync_log: %v", err)
			}
		}
	}

	// ── Physical Slew-Rate / Thermal Inertia Guard ─────────────────────────────
	// When two ESP32s publish with the same nodeId without MAC or channel, they
	// produce rapid alternating jumps on continuous parameters (e.g. oilTemp 40°C
	// and 76°C interleaved).
	// A 500kVA+ transformer oil reservoir has tons of oil mass: oil cannot change
	// faster than 0.5°C/s (30°C/min), windingTemp cannot change faster than 1.0°C/s.
	// Jumps exceeding this physical limit are impossible on a single unit and prove
	// either (1) two colliding streams on the same nodeId, or (2) sensor wire open/short.

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
		canonical := canonicalParam(key)
		normalized[canonical] = val

		// Layer 1: Check physical slew rate to catch dual hardware without MAC
		if violated, jump := checkPhysicalSlew(t.NodeID, canonical, val, ts); violated {
			statIdentityConflicts.Add(1)
			log.Printf("PHYSICAL SLEW-RATE VIOLATION on %s [%s]: jumped %.1f in short window — duplicate hardware or sensor fault detected; flagging identity conflict", t.NodeID, canonical, jump)
			_, _ = controlDB.Exec("UPDATE device_presence SET identity_conflict_at = COALESCE(identity_conflict_at, NOW(3)) WHERE node_id = ?", t.NodeID)
		}
	}
	t.Values = normalized

	stored := 0
	if len(t.Values) > 0 {
		var (
			queryBuilder strings.Builder
			args         = make([]interface{}, 0, len(t.Values)*4)
			idx          = 0
		)
		queryBuilder.WriteString("INSERT IGNORE INTO readings (node_id, param_key, value, taken_at) VALUES ")
		for key, val := range t.Values {
			if idx > 0 {
				queryBuilder.WriteString(", ")
			}
			queryBuilder.WriteString("(?, ?, ?, ?)")
			args = append(args, t.NodeID, key, val, ts)
			idx++
		}
		if _, err := tenantDB.Exec(queryBuilder.String(), args...); err != nil {
			log.Printf("DB Batch Insert Error for org %s node %s: %v", orgID, t.NodeID, err)
			statErrors.Add(int64(len(t.Values)))
		} else {
			stored = len(t.Values)
			statReadings.Add(int64(stored))
		}
	}

	// Stamp when this device last delivered actual measurements. This is NOT the
	// same as last_seen: last_seen also moves on heartbeat/status frames (every
	// 30s), so it cannot tell "the parameters stopped updating" from "the device
	// is still talking". The presence sweep raises LINK_LOST off this column, so
	// the link loss is on the timeline well before the device is declared
	// offline instead of both landing in the same second.
	if stored > 0 && time.Now().UnixMilli() >= lastReadingRetryAt.Load() {
		// GREATEST, not a plain assignment: a device flushing its offline backlog
		// replays frames with OLD timestamps, and moving the column backwards
		// would make the sweep declare the link lost the moment it recovered.
		if _, err := controlDB.Exec(
			"UPDATE device_presence SET last_reading_at = GREATEST(COALESCE(last_reading_at, ?), ?) WHERE node_id = ?",
			ts, ts, t.NodeID); err != nil {
			// The column ships in migrate-v19. Until that runs, this fails on every
			// frame — several times a second per device — so back off instead of
			// flooding the log, and keep retrying so it starts working on its own
			// once the migration lands (no pod restart needed).
			lastReadingRetryAt.Store(time.Now().Add(lastReadingRetry).UnixMilli())
			log.Printf("last_reading_at update failed for %s (retrying in %s): %v", t.NodeID, lastReadingRetry, err)
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

	// Independent of the shared rule above (and unconditional on `ok`): a
	// personal threshold can exist whether or not this node has an org-wide
	// rule configured at all.
	if personalRules := getPersonalRules(tenantDB, t.NodeID); len(personalRules) > 0 {
		evaluatePersonalAlarms(client, orgID, t, ts, personalRules)
	}
}

// nullableStr passes a NULL through to the driver instead of an empty string, so
// a device without a department keeps a NULL department_id rather than "".
func nullableStr(v sql.NullString) interface{} {
	if !v.Valid {
		return nil
	}
	return v.String
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
//
// Oiltemp/H2/OilMoisture/Tamb are the real ETERNITY transformer's actual wire
// spellings (confirmed against a live MQTT payload) — none of the spellings
// above matched them, so oil temperature, hydrogen, moisture and ambient temp
// were being stored under their raw wire keys and were invisible to every
// alarm rule and device page, which only ever look up the canonical key.
// Tbox/RHamb/RHbox (enclosure temp, ambient/enclosure humidity) are deliberately
// NOT mapped here: there is no existing canonical param or defensible
// engineering threshold for them yet, so they pass through unmapped rather than
// being aliased to a made-up key nothing alarms on.
var paramMap = map[string]string{
	"oil_temp_c":           "oilTemp",
	"oil_temp":             "oilTemp",
	"oiltemp":              "oilTemp",
	"Oiltemp":              "oilTemp",
	"ambient_temp_c":       "ambientTemp",
	"ambient_temp":         "ambientTemp",
	"Tamb":                 "ambientTemp",
	"winding_temp_c":       "windingTemp",
	"dga_h2_ppm":           "hydrogen",
	"hydrogen_ppm":         "hydrogen",
	"H2":                   "hydrogen",
	"moisture_ppm":         "moisture",
	"oil_moisture":         "moisture",
	"oil_moisture_ppm":     "moisture",
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

	// --- power meter model B (short names) -> model A (long names) ---------
	//
	// The fleet runs two meter models that measure the same quantities under
	// different spellings: tr-221 publishes CurrentA/ActivepowerA/PFA, tr-111
	// publishes Ia/Pa/PFa. Aliasing model B onto model A's names lets ONE
	// alarm rule cover both, instead of every threshold having to be entered
	// twice under two spellings.
	//
	// Only pairs whose meaning is confirmed identical from the captured
	// frames (e2e/fixtures/real-device-payloads.json) are aliased. Three are
	// deliberately NOT:
	//   V3pavg  averages LINE-TO-LINE (395.9 V) while VoltLN_AVG averages
	//           line-to-neutral (228.9 V) — same word "avg", different
	//           measurement; folding them together would compare a 400 V
	//           quantity against a 230 V limit.
	//   I3p     is a three-phase total (221.9 A ≈ Ia+Ib+Ic), not the average
	//           CurrentAVG holds.
	//   GHG     has no model-A counterpart at all.
	"Va":     "VoltAN",
	"Vb":     "VoltBN",
	"Vc":     "VoltCN",
	"Ia":     "CurrentA",
	"Ib":     "CurrentB",
	"Ic":     "CurrentC",
	"Pa":     "ActivepowerA",
	"Pb":     "ActivepowerB",
	"Pc":     "ActivepowerC",
	"VAa":    "ApparentpowerA",
	"VAb":    "ApparentpowerB",
	"VAc":    "ApparentpowerC",
	"VARa":   "ReactivepowerA",
	"VARb":   "ReactivepowerB",
	"VARc":   "ReactivepowerC",
	"PFa":    "PFA",
	"PFb":    "PFB",
	"PFc":    "PFC",
	"I3pavg": "CurrentAVG",
	"P3p":    "ActivepowerTotal",
	"VA3p":   "ApparentpowerTotal",
	"VAR3p":  "ReactivepowerTotal",
	"PF3p":   "PFTotal",
	"V3pab":  "VoltAB",
	"V3pbc":  "VoltBC",
	"V3pca":  "VoltCA",
	"kWh3p":  "kWh",
}

// canonicalParam returns the canonical key for a raw wire key (unchanged when
// the key is already canonical or unknown, so new sensors still flow through).
func canonicalParam(key string) string {
	if c, ok := paramMap[key]; ok {
		return c
	}
	return key
}

// dbConfig builds the connection config from component env vars. Credentials go
// in as struct fields rather than being pasted into a DSN string: a root
// password containing DSN-special characters (@ : / ?) — common for randomly
// generated secrets — corrupts a hand-built "root:PASS@tcp(...)" and yields
// "Access denied", even though the CLI (mysql -p) accepts the same value.
// DB_PASSWORD comes from the mysql-credentials Secret.
// dbLoc returns the fixed zone matching the database's wall-clock convention.
// The platform stores wall times in DB_TZ (default +07:00): MySQL runs with
// --default-time-zone=+07:00 and Node-RED's mysql2 pools set timezone '+07:00',
// so every NOW(3) row is ICT wall time. This driver, however, formats time.Time
// in cfg.Loc — which defaults to UTC — so the worker was writing UTC wall times
// (taken_at, last_reading_at, oldest_ts…) into a +07:00 database: every value it
// wrote landed 7 hours in the past. That is why the header badge said
// "7h ago" for a device that had been up seconds earlier.
func dbLoc() *time.Location {
	tz := getEnv("DB_TZ", "+07:00")
	var sign, hh, mm int
	if n, err := fmt.Sscanf(tz, "+%d:%d", &hh, &mm); n == 2 && err == nil {
		sign = 1
	} else if n, err := fmt.Sscanf(tz, "-%d:%d", &hh, &mm); n == 2 && err == nil {
		sign = -1
	} else {
		log.Printf("DB_TZ %q not parseable, falling back to +07:00", tz)
		sign, hh, mm = 1, 7, 0
	}
	return time.FixedZone("DBTZ", sign*(hh*3600+mm*60))
}

func dbConfig(dbName string) *mysql.Config {
	cfg := mysql.NewConfig()
	cfg.User = getEnv("DB_USER", "root")
	cfg.Passwd = getEnv("DB_PASSWORD", "password")
	cfg.Net = "tcp"
	cfg.Addr = getEnv("DB_HOST", "mysql") + ":" + getEnv("DB_PORT", "3306")
	cfg.DBName = dbName
	cfg.ParseTime = true
	// Write AND read wall times in the DB's own zone (see dbLoc). Loc converts
	// outgoing time.Time values before formatting and stamps parsed DATETIMEs on
	// the way in, so a round trip is the identity again.
	cfg.Loc = dbLoc()
	return cfg
}

// openDB connects via a Connector rather than a DSN string. FormatDSN would
// serialise cfg.Loc by NAME (loc=DBTZ) and ParseDSN then feeds that name to
// time.LoadLocation — which fails with "unknown time zone DBTZ" for a
// FixedZone, and would need the tzdata files in the image for a real zone name
// like Asia/Bangkok. NewConnector keeps the *time.Location object itself, so a
// fixed offset works with no tzdata dependency.
func openDB(dbName string) (*sql.DB, error) {
	connector, err := mysql.NewConnector(dbConfig(dbName))
	if err != nil {
		return nil, err
	}
	return sql.OpenDB(connector), nil
}
