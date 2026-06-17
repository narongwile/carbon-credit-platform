-- Demo fleet seed — mirrors src/lib/fleetData.ts so the fleet/overview API has
-- data without provisioning. Idempotent. Run after schema.sql.
-- mqtt_prefix matches the ESP32 firmware default (OO_TOPIC_ROOT=telemetry,
-- tenant=acme, product = domain mapped: transformer→eternity, carbonNode→carbonbox,
-- bloodBox→bloodbox) so downlink config/cmd/ota reaches the device.
USE iothub;

INSERT IGNORE INTO nodes (id, org_id, site_id, domain, name, mqtt_prefix) VALUES
  -- org-1 (transformer + carbonNode)
  ('tr-001','org-1','site-1a','transformer','Transformer TR-001','telemetry/acme/eternity/tr-001'),
  ('tr-002','org-1','site-1a','transformer','Transformer TR-002','telemetry/acme/eternity/tr-002'),
  ('tr-003','org-1','site-1a','transformer','Transformer TR-003','telemetry/acme/eternity/tr-003'),
  ('tr-004','org-1','site-1b','transformer','Transformer TR-004','telemetry/acme/eternity/tr-004'),
  ('tr-005','org-1','site-1b','transformer','Transformer TR-005','telemetry/acme/eternity/tr-005'),
  ('cn-01','org-1','site-1a','carbonNode','Fridge CN-01','telemetry/acme/carbonbox/cn-01'),
  ('cn-02','org-1','site-1b','carbonNode','Fridge CN-02','telemetry/acme/carbonbox/cn-02'),
  ('cn-03','org-1','site-1b','carbonNode','Fridge CN-03','telemetry/acme/carbonbox/cn-03'),
  -- org-2 (transformer + bloodBox)
  ('tr-101','org-2','site-2a','transformer','Transformer TR-101','telemetry/acme/eternity/tr-101'),
  ('tr-102','org-2','site-2a','transformer','Transformer TR-102','telemetry/acme/eternity/tr-102'),
  ('tr-103','org-2','site-2a','transformer','Transformer TR-103','telemetry/acme/eternity/tr-103'),
  ('bb-101','org-2','site-2a','bloodBox','BloodBOX BB-101','telemetry/acme/bloodbox/bb-101'),
  -- org-3 (all products)
  ('tr-301','org-3','site-3a','transformer','Transformer TR-301','telemetry/acme/eternity/tr-301'),
  ('tr-302','org-3','site-3a','transformer','Transformer TR-302','telemetry/acme/eternity/tr-302'),
  ('tr-303','org-3','site-3a','transformer','Transformer TR-303','telemetry/acme/eternity/tr-303'),
  ('cn-301','org-3','site-3a','carbonNode','Fridge CN-301','telemetry/acme/carbonbox/cn-301'),
  ('bb-301','org-3','site-3a','bloodBox','BloodBOX BB-301','telemetry/acme/bloodbox/bb-301');
