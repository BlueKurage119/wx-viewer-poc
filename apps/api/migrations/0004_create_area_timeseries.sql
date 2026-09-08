CREATE TABLE area_timeseries_snapshot (
  id INTEGER PRIMARY KEY,
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  station_code TEXT NOT NULL,
  station_name TEXT NOT NULL,
  control_status TEXT NOT NULL CHECK (control_status IN ('normal', 'training', 'test')),
  info_type TEXT NOT NULL,
  event_id TEXT,
  report_datetime TEXT NOT NULL,
  control_datetime TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source <> ''),
  issued_at TEXT NOT NULL,
  valid_at TEXT,
  valid_from TEXT,
  valid_to TEXT,
  fetched_at TEXT NOT NULL,
  last_success_at TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'stale', 'unavailable')),
  source_version TEXT,
  UNIQUE (area_code, station_code, control_status)
);

CREATE TABLE area_timeseries_time_define (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES area_timeseries_snapshot(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  time_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  time_from TEXT NOT NULL,
  time_to TEXT NOT NULL,
  duration TEXT,
  UNIQUE (snapshot_id, block_id, time_id)
);

CREATE TABLE area_timeseries_value (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL,
  block_id TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  element TEXT NOT NULL,
  value_code TEXT,
  value_text TEXT,
  value_number REAL,
  unit TEXT,
  sequence INTEGER NOT NULL,
  FOREIGN KEY (snapshot_id, block_id, ref_id) REFERENCES area_timeseries_time_define(snapshot_id, block_id, time_id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES area_timeseries_snapshot(id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, block_id, ref_id, element)
);
