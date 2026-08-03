-- migrate-v31.sql — real transformer nameplate data, replacing fabricated Asset Info
--
-- The 'Individual Device (FIX)' Asset Info panel (FixDashboard.tsx, th-fix,
-- used on every /admin/nodes/detail and /customer/devices/detail page)
-- hardcodes 'TR-6787' / '2500 kVA' / '22kV/0.4kV' for every transformer on the
-- platform, unconditionally. The better-shaped 'Transformer Digital Twin' panel
-- (TransformerDetailView, th-twin) reads transformer.model/.kva/.voltage/
-- .manufacturer/.installDate/.serialNumber, but for a real customer device (no
-- seed-array match) those fall back to the same '—'/0 placeholders, because
-- `nodes` never grew nameplate columns (schema.sql) and nothing else ever wrote
-- them. A device auto-registered from its first MQTT frame carries zero spec
-- data, forever.
--
-- Same shape of problem as node_images (migrate-v27), same fix shape: an admin
-- enters what is actually on the unit's nameplate; until they do, the UI says
-- so instead of lying. Deliberately NOT a full IEC 60076-1 transcription —
-- vector group, impedance %, tap-changer detail, mass, insulating-liquid type,
-- frequency and phase count are design-engineering data nobody reads while
-- triaging an oil-temp alarm, and are already captured losslessly by the
-- admin-uploaded device photo (node_images) for the rare specialist who needs
-- them. This table holds only the fields the two existing panels already try
-- to render, plus cooling_type — the one IEC field not shown anywhere today
-- that changes how ops reads the oil-temp trend card right beside it (an OFAF
-- unit's normal baseline differs from an ONAN unit's).
--
-- Lives in the ORG database, exactly like node_images: nodes does, and a
-- nameplate for a device that is not in the same database as the device is a
-- row nothing can join to. No org_id column — the node already belongs to
-- exactly one org (nodes.org_id); every read/write resolves its pool via
-- orgOfNode/ownOrg the same way the photo endpoints do.
--
-- Every column nullable except the key: an admin who knows the rating today
-- but not the serial number must be able to save that much and come back
-- later. Forcing all-or-nothing entry is how you get zero real rows.
USE iothub;

CREATE TABLE IF NOT EXISTS node_nameplates (
  node_id         VARCHAR(64) PRIMARY KEY,
  manufacturer    VARCHAR(120),
  model           VARCHAR(120),
  serial_number   VARCHAR(120),
  rated_kva       DECIMAL(10,2),
  voltage_class   VARCHAR(64),
  cooling_type    VARCHAR(32),
  year_installed  SMALLINT,
  updated_by      VARCHAR(120),
  updated_at      DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

-- Seed the three demo orgs' transformers with the model/kVA/voltage/serial
-- already hardcoded in fleetData.ts — moving existing sample data into the
-- real table, not inventing new content. Deliberately NOT carrying forward
-- mockData.ts's hash-fabricated manufacturer/installDate: leaving those NULL
-- on demo units keeps the 'not entered yet' state visibly exercised in the
-- one environment everyone looks at first, instead of swapping one invented
-- value for another.
INSERT IGNORE INTO node_nameplates (node_id, model, serial_number, rated_kva, voltage_class) VALUES
  ('tr-001','TR-6787','SN100231',2500,'22kV/0.4kV'),
  ('tr-002','TR-5512','SN100232',1500,'11kV/0.4kV'),
  ('tr-003','TR-6787','SN100240',2000,'22kV/0.4kV'),
  ('tr-004','TR-9001','SN100241',3000,'33kV/11kV'),
  ('tr-005','TR-5512','SN100242',1500,'11kV/0.4kV'),
  ('tr-101','TR-9001','SN200110',3000,'33kV/11kV'),
  ('tr-102','TR-6787','SN200111',2500,'22kV/0.4kV'),
  ('tr-103','TR-5512','SN200112',1500,'11kV/0.4kV'),
  ('tr-301','TR-9001','SN300110',3000,'115kV/22kV'),
  ('tr-302','TR-6787','SN300111',2500,'33kV/11kV'),
  ('tr-303','TR-5512','SN300112',2000,'22kV/0.4kV');
