CREATE TABLE early_warning_snapshot (
  id INTEGER PRIMARY KEY,
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('near', 'far')),
  telegram_type TEXT NOT NULL,
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
  UNIQUE (area_code, segment, control_status)
);

CREATE TABLE early_warning_time_define (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES early_warning_snapshot(id) ON DELETE CASCADE,
  time_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  time_from TEXT NOT NULL,
  time_to TEXT NOT NULL,
  duration TEXT,
  UNIQUE (snapshot_id, time_id)
);

CREATE TABLE early_warning_cell (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL,
  ref_id TEXT NOT NULL,
  phenomenon_code TEXT NOT NULL,
  phenomenon_name TEXT NOT NULL,
  rank_value TEXT,
  condition TEXT,
  FOREIGN KEY (snapshot_id, ref_id) REFERENCES early_warning_time_define(snapshot_id, time_id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES early_warning_snapshot(id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, ref_id, phenomenon_code)
);
