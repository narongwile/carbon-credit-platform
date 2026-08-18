-- migrate-v48.sql — Standard Industrial Alarm List & Root Cause Catalog
USE iothub;

-- Seed comprehensive industrial root causes / event problems for transformer domain
-- (Allows operators to tag exact electrical, thermal, power quality, and external fault causes)
INSERT IGNORE INTO event_problems (id, org_id, department_id, domain, label) VALUES
  ('ep-oil-high-org1', 'org-1', NULL, 'transformer', 'Top Oil Temperature High (> 85°C)'),
  ('ep-oil-crit-org1', 'org-1', NULL, 'transformer', 'Top Oil Temperature Critical (Insulation Damage Risk > 90°C)'),
  ('ep-volt-over-org1', 'org-1', NULL, 'transformer', 'Over Voltage (Equipment Damage Risk > +10%)'),
  ('ep-volt-under-org1', 'org-1', NULL, 'transformer', 'Under Voltage (Low Voltage Trip < -10%)'),
  ('ep-curr-over-org1', 'org-1', NULL, 'transformer', 'Over Current / Overload (> 100% to 115%)'),
  ('ep-curr-crit-org1', 'org-1', NULL, 'transformer', 'Over Current / Short Circuit Risk (> 115%)'),
  ('ep-unbal-warn-org1', 'org-1', NULL, 'transformer', 'Voltage Unbalance High (> 2%)'),
  ('ep-unbal-crit-org1', 'org-1', NULL, 'transformer', 'Voltage Unbalance Critical (> 5%)'),
  ('ep-ext-fault-org1', 'org-1', NULL, 'transformer', 'External Fault/Event (Animals, Lightning, Shutdown)'),

  ('ep-oil-high-org2', 'org-2', NULL, 'transformer', 'Top Oil Temperature High (> 85°C)'),
  ('ep-oil-crit-org2', 'org-2', NULL, 'transformer', 'Top Oil Temperature Critical (Insulation Damage Risk > 90°C)'),
  ('ep-volt-over-org2', 'org-2', NULL, 'transformer', 'Over Voltage (Equipment Damage Risk > +10%)'),
  ('ep-volt-under-org2', 'org-2', NULL, 'transformer', 'Under Voltage (Low Voltage Trip < -10%)'),
  ('ep-curr-over-org2', 'org-2', NULL, 'transformer', 'Over Current / Overload (> 100% to 115%)'),
  ('ep-curr-crit-org2', 'org-2', NULL, 'transformer', 'Over Current / Short Circuit Risk (> 115%)'),
  ('ep-unbal-warn-org2', 'org-2', NULL, 'transformer', 'Voltage Unbalance High (> 2%)'),
  ('ep-unbal-crit-org2', 'org-2', NULL, 'transformer', 'Voltage Unbalance Critical (> 5%)'),
  ('ep-ext-fault-org2', 'org-2', NULL, 'transformer', 'External Fault/Event (Animals, Lightning, Shutdown)');
