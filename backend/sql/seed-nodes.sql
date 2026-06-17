-- Demo fleet seed — mirrors src/lib/fleetData.ts so the fleet/overview/map API
-- has data without provisioning. Idempotent. Run after schema.sql.
-- mqtt_prefix matches the ESP32 firmware default (OO_TOPIC_ROOT=telemetry,
-- tenant=acme, product = domain mapped). lat/lng are the site coordinates.
USE iothub;

INSERT IGNORE INTO nodes (id, org_id, site_id, domain, name, mqtt_prefix, lat, lng) VALUES
  -- org-1 — site-1a (13.6512,100.4964) / site-1b (13.6518,100.4971)
  ('tr-001','org-1','site-1a','transformer','Transformer TR-001','telemetry/acme/eternity/tr-001',13.6512,100.4964),
  ('tr-002','org-1','site-1a','transformer','Transformer TR-002','telemetry/acme/eternity/tr-002',13.6513,100.4966),
  ('tr-003','org-1','site-1a','transformer','Transformer TR-003','telemetry/acme/eternity/tr-003',13.6511,100.4962),
  ('tr-004','org-1','site-1b','transformer','Transformer TR-004','telemetry/acme/eternity/tr-004',13.6518,100.4971),
  ('tr-005','org-1','site-1b','transformer','Transformer TR-005','telemetry/acme/eternity/tr-005',13.6519,100.4973),
  ('cn-01','org-1','site-1a','carbonNode','Fridge CN-01','telemetry/acme/carbonbox/cn-01',13.6512,100.4965),
  ('cn-02','org-1','site-1b','carbonNode','Fridge CN-02','telemetry/acme/carbonbox/cn-02',13.6517,100.4970),
  ('cn-03','org-1','site-1b','carbonNode','Fridge CN-03','telemetry/acme/carbonbox/cn-03',13.6520,100.4972),
  -- org-2 — site-2a (13.3611,100.9847)
  ('tr-101','org-2','site-2a','transformer','Transformer TR-101','telemetry/acme/eternity/tr-101',13.3611,100.9847),
  ('tr-102','org-2','site-2a','transformer','Transformer TR-102','telemetry/acme/eternity/tr-102',13.3613,100.9849),
  ('tr-103','org-2','site-2a','transformer','Transformer TR-103','telemetry/acme/eternity/tr-103',13.3609,100.9845),
  ('bb-101','org-2','site-2a','bloodBox','BloodBOX BB-101','telemetry/acme/bloodbox/bb-101',13.3612,100.9848),
  -- org-3 — site-3a (1.3521,103.8198)
  ('tr-301','org-3','site-3a','transformer','Transformer TR-301','telemetry/acme/eternity/tr-301',1.3521,103.8198),
  ('tr-302','org-3','site-3a','transformer','Transformer TR-302','telemetry/acme/eternity/tr-302',1.3523,103.8200),
  ('tr-303','org-3','site-3a','transformer','Transformer TR-303','telemetry/acme/eternity/tr-303',1.3519,103.8196),
  ('cn-301','org-3','site-3a','carbonNode','Fridge CN-301','telemetry/acme/carbonbox/cn-301',1.3522,103.8199),
  ('bb-301','org-3','site-3a','bloodBox','BloodBOX BB-301','telemetry/acme/bloodbox/bb-301',1.3520,103.8197);
