CREATE TABLE warning_current_snapshot (
  id INTEGER PRIMARY KEY,
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
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
  UNIQUE (area_code, control_status)
);

CREATE TABLE warning_current_item (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES warning_current_snapshot(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind_code TEXT NOT NULL,
  kind_name TEXT NOT NULL,
  kind_status TEXT NOT NULL,
  last_kind_code TEXT,
  last_kind_name TEXT,
  significancy_code TEXT,
  significancy_name TEXT,
  warning_level TEXT,
  attention_text TEXT,
  kind_issued_at TEXT,
  source_telegram TEXT NOT NULL,
  UNIQUE (snapshot_id, kind_code)
);
