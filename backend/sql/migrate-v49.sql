-- migrate-v49.sql — Add 'automobile' domain (Formula EV / Driver Fatigue 1D-CNN Telemetry)
USE iothub;

-- 1. Widen nodes.domain enum to include 'automobile'
ALTER TABLE nodes MODIFY COLUMN domain ENUM('transformer','carbonNode','bloodBox','automobile') NOT NULL;

-- 2. Entitle org-1 to the automobile platform
INSERT IGNORE INTO org_entitlements (org_id, platform) VALUES
  ('org-1', 'automobile');

-- 3. Seed default org_domain_rules for automobile on org-1
INSERT IGNORE INTO org_domain_rules (org_id, domain, rule_json, debounce_json, updated_by) VALUES
  ('org-1', 'automobile', JSON_OBJECT(
    'dwellMin', 2,
    'hysteresis', 2.0,
    'params', JSON_ARRAY(
      JSON_OBJECT('key', 'fatigue_score', 'label', 'Driver Fatigue Risk Index (1D-CNN)', 'warn', 70.0, 'critical', 85.0, 'direction', 'high', 'unit', '%'),
      JSON_OBJECT('key', 'hr_bpm', 'label', 'Driver Heart Rate', 'warn', 110.0, 'critical', 130.0, 'direction', 'high', 'unit', 'BPM'),
      JSON_OBJECT('key', 'fatigue_ratio', 'label', 'Neural EEG Fatigue Ratio (Theta+Alpha)/Beta', 'warn', 4.0, 'critical', 6.0, 'direction', 'high', 'unit', 'ratio'),
      JSON_OBJECT('key', 'eeg_theta', 'label', 'EEG Theta Band Surge (Microsleep Indication)', 'warn', 30.0, 'critical', 45.0, 'direction', 'high', 'unit', 'μV'),
      JSON_OBJECT('key', 'speed_kmh', 'label', 'Vehicle Telemetry Speed', 'warn', 120.0, 'critical', 140.0, 'direction', 'high', 'unit', 'km/h'),
      JSON_OBJECT('key', 'steering_angle', 'label', 'Steering Reversal Deviation', 'warn', 45.0, 'critical', 60.0, 'direction', 'high', 'unit', 'deg')
    )
  ), JSON_OBJECT(
    'fatigue_score', JSON_OBJECT('dwell_min', 2, 'cooldown_s', 30),
    'hr_bpm', JSON_OBJECT('dwell_min', 3, 'cooldown_s', 60),
    'fatigue_ratio', JSON_OBJECT('dwell_min', 2, 'cooldown_s', 30)
  ), 'system');

-- 4. Seed root causes / event problems for automobile domain
INSERT IGNORE INTO event_problems (id, org_id, department_id, domain, label) VALUES
  ('ep-fatigue-crit-org1', 'org-1', NULL, 'automobile', 'Driver Fatigue Critical Alert (High Microsleep Risk > 85%)'),
  ('ep-fatigue-warn-org1', 'org-1', NULL, 'automobile', 'Driver Drowsiness Warning (Fatigue Index > 70%)'),
  ('ep-hr-high-org1', 'org-1', NULL, 'automobile', 'Driver Heart Rate Tachycardia (> 110 BPM)'),
  ('ep-eeg-theta-org1', 'org-1', NULL, 'automobile', 'High Theta EEG Surge (Drowsiness Indication > 30 μV)'),
  ('ep-can-lost-org1', 'org-1', NULL, 'automobile', 'Vehicle CAN-Bus Communication Lost');

-- 5. Seed initial NAT Gateway Node for org-1
INSERT IGNORE INTO nodes (id, org_id, site_id, department_id, domain, name, mqtt_prefix, lat, lng, status) VALUES
  ('NAT-GW-01', 'org-1', NULL, NULL, 'automobile', 'NAT-GW-01 Formula EV', 'telemetry/org-1/automobile/NAT-GW-01', 13.6514, 100.4965, 'active');

-- 6. Seed alarm rule for NAT-GW-01
INSERT IGNORE INTO alarm_rules (node_id, org_id, domain, rule_json, updated_by) VALUES
  ('NAT-GW-01', 'org-1', 'automobile', JSON_OBJECT(
    'dwellMin', 2,
    'hysteresis', 2.0,
    'params', JSON_ARRAY(
      JSON_OBJECT('key', 'fatigue_score', 'label', 'Driver Fatigue Risk Index (1D-CNN)', 'warn', 70.0, 'critical', 85.0, 'direction', 'high', 'unit', '%'),
      JSON_OBJECT('key', 'hr_bpm', 'label', 'Driver Heart Rate', 'warn', 110.0, 'critical', 130.0, 'direction', 'high', 'unit', 'BPM'),
      JSON_OBJECT('key', 'fatigue_ratio', 'label', 'Neural EEG Fatigue Ratio (Theta+Alpha)/Beta', 'warn', 4.0, 'critical', 6.0, 'direction', 'high', 'unit', 'ratio'),
      JSON_OBJECT('key', 'eeg_theta', 'label', 'EEG Theta Band Surge', 'warn', 30.0, 'critical', 45.0, 'direction', 'high', 'unit', 'μV'),
      JSON_OBJECT('key', 'speed_kmh', 'label', 'Vehicle Speed', 'warn', 120.0, 'critical', 140.0, 'direction', 'high', 'unit', 'km/h'),
      JSON_OBJECT('key', 'steering_angle', 'label', 'Steering Reversal Deviation', 'warn', 45.0, 'critical', 60.0, 'direction', 'high', 'unit', 'deg')
    )
  ), 'system');

-- 7. Seed device presence
INSERT IGNORE INTO device_presence (node_id, online, last_seen, transport, fw_version, ip) VALUES
  ('NAT-GW-01', 1, NOW(3), 'wifi', '1.0.0', '192.168.1.150')
ON DUPLICATE KEY UPDATE online = 1, last_seen = NOW(3);
