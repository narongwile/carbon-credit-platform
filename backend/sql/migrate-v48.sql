-- migrate-v48.sql — Standard Industrial Alarm List & Root Cause Catalog for ETERNITY
USE iothub;

-- Ensure org-eternity exists and has eternityTransformers platform entitlement
INSERT IGNORE INTO organizations (id, name, status) VALUES
  ('org-eternity', 'Eternity Transformers', 'active');

INSERT IGNORE INTO org_entitlements (org_id, platform) VALUES
  ('org-eternity', 'eternityTransformers');

-- Seed comprehensive industrial root causes / event problems for org-eternity
INSERT IGNORE INTO event_problems (id, org_id, department_id, domain, label) VALUES
  ('ep-oil-high-eternity', 'org-eternity', NULL, 'transformer', 'Top Oil Temperature High (> 85°C)'),
  ('ep-oil-crit-eternity', 'org-eternity', NULL, 'transformer', 'Top Oil Temperature Critical (Insulation Damage Risk > 90°C)'),
  ('ep-volt-over-eternity', 'org-eternity', NULL, 'transformer', 'Over Voltage (Equipment Damage Risk > +10%)'),
  ('ep-volt-under-eternity', 'org-eternity', NULL, 'transformer', 'Under Voltage (Low Voltage Trip < -10%)'),
  ('ep-curr-over-eternity', 'org-eternity', NULL, 'transformer', 'Over Current / Overload (> 100% to 115%)'),
  ('ep-curr-crit-eternity', 'org-eternity', NULL, 'transformer', 'Over Current / Short Circuit Risk (> 115%)'),
  ('ep-unbal-warn-eternity', 'org-eternity', NULL, 'transformer', 'Voltage Unbalance High (> 2%)'),
  ('ep-unbal-crit-eternity', 'org-eternity', NULL, 'transformer', 'Voltage Unbalance Critical (> 5%)'),
  ('ep-ext-fault-eternity', 'org-eternity', NULL, 'transformer', 'External Fault/Event (Animals, Lightning, Shutdown)'),

  -- Seed for demo transformer tenants (org-1, org-2)
  ('ep-oil-high-org1', 'org-1', NULL, 'transformer', 'Top Oil Temperature High (> 85°C)'),
  ('ep-oil-crit-org1', 'org-1', NULL, 'transformer', 'Top Oil Temperature Critical (Insulation Damage Risk > 90°C)'),
  ('ep-volt-over-org1', 'org-1', NULL, 'transformer', 'Over Voltage (Equipment Damage Risk > +10%)'),
  ('ep-volt-under-org1', 'org-1', NULL, 'transformer', 'Under Voltage (Low Voltage Trip < -10%)'),
  ('ep-curr-over-org1', 'org-1', NULL, 'transformer', 'Over Current / Overload (> 100% to 115%)'),
  ('ep-curr-crit-org1', 'org-1', NULL, 'transformer', 'Over Current / Short Circuit Risk (> 115%)'),
  ('ep-unbal-warn-org1', 'org-1', NULL, 'transformer', 'Voltage Unbalance High (> 2%)'),
  ('ep-unbal-crit-org1', 'org-1', NULL, 'transformer', 'Voltage Unbalance Critical (> 5%)'),
  ('ep-ext-fault-org1', 'org-1', NULL, 'transformer', 'External Fault/Event (Animals, Lightning, Shutdown)');

