-- BloodBOX domain (ERD #4). Run after schema.sql.
USE iothub;

CREATE TABLE IF NOT EXISTS building_floors (
  id            VARCHAR(64) PRIMARY KEY,
  org_id        VARCHAR(64) NOT NULL,
  site_id       VARCHAR(64),
  building_code VARCHAR(20),
  floor_number  SMALLINT NOT NULL,
  name          VARCHAR(80),
  floorplan_url TEXT,
  width_m       DECIMAL(8,2),
  height_m      DECIMAL(8,2),
  UNIQUE KEY uq_floor (site_id, building_code, floor_number),
  INDEX (org_id)
);

CREATE TABLE IF NOT EXISTS blood_boxes (
  id          VARCHAR(64) PRIMARY KEY,
  org_id      VARCHAR(64) NOT NULL,
  site_id     VARCHAR(64),
  box_code    VARCHAR(40) UNIQUE,
  name        VARCHAR(80),
  set_low_c   DECIMAL(5,2),
  set_high_c  DECIMAL(5,2),
  capacity_units INT,
  floor_id    VARCHAR(64),
  pos_x_m     DECIMAL(8,2),
  pos_y_m     DECIMAL(8,2),
  status      ENUM('idle','in_transit','stored') DEFAULT 'idle',
  INDEX (org_id)
);

CREATE TABLE IF NOT EXISTS blood_box_locations (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id      VARCHAR(64) NOT NULL,
  box_id      VARCHAR(64) NOT NULL,
  floor_id    VARCHAR(64),
  pos_x_m     DECIMAL(8,2),
  pos_y_m     DECIMAL(8,2),
  room_label  VARCHAR(80),
  moved_at    DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  moved_by    VARCHAR(120),
  is_current  TINYINT(1) DEFAULT 1,
  INDEX (box_id, is_current)
);

CREATE TABLE IF NOT EXISTS ble_beacons (
  id          VARCHAR(64) PRIMARY KEY,
  org_id      VARCHAR(64) NOT NULL,
  floor_id    VARCHAR(64) NOT NULL,
  uuid        CHAR(36) NOT NULL,
  major       SMALLINT,
  minor       SMALLINT,
  pos_x_m     DECIMAL(8,2),
  pos_y_m     DECIMAL(8,2),
  tx_power_dbm SMALLINT,
  battery_pct TINYINT,
  status      ENUM('active','inactive','low_battery') DEFAULT 'active',
  UNIQUE KEY uq_beacon (uuid, major, minor),
  INDEX (org_id), INDEX (floor_id)
);

CREATE TABLE IF NOT EXISTS blood_box_transits (
  id            VARCHAR(64) PRIMARY KEY,
  org_id        VARCHAR(64) NOT NULL,
  box_id        VARCHAR(64),
  box_code      VARCHAR(40),
  from_label    VARCHAR(120),
  to_label      VARCHAR(120),
  courier       VARCHAR(120),
  courier_phone VARCHAR(40),
  planned_eta_min INT,
  current_eta_min INT,
  departed_at   DATETIME(3),
  arrived_at    DATETIME(3),
  temp_min_c    DECIMAL(5,2),
  temp_max_c    DECIMAL(5,2),
  current_temp_c DECIMAL(5,2),
  status        ENUM('in_transit','arrived','delayed') DEFAULT 'in_transit',
  INDEX (org_id)
);

CREATE TABLE IF NOT EXISTS blood_box_journey_events (
  id          VARCHAR(64) PRIMARY KEY,
  transit_id  VARCHAR(64) NOT NULL,
  floor_id    VARCHAR(64),
  event_type  ENUM('gps_checkin','building_entered','security_pass','lift_entered','lift_exited','storage_arrived') NOT NULL,
  label       VARCHAR(160),
  signal      ENUM('GPS','BLE','BAROMETER','MANUAL') NOT NULL,
  lat         DECIMAL(10,7),
  lng         DECIMAL(10,7),
  pos_x_m     DECIMAL(8,2),
  pos_y_m     DECIMAL(8,2),
  temp_c      DECIMAL(5,2),
  battery_pct TINYINT,
  ts          DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX (transit_id)
);
