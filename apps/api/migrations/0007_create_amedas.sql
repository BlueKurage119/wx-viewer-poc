CREATE TABLE amedas_snapshot (
  id INTEGER PRIMARY KEY,
  station_code TEXT NOT NULL,
  station_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source <> ''),
  issued_at TEXT NOT NULL,
  valid_at TEXT,
  valid_from TEXT,
  valid_to TEXT,
  fetched_at TEXT NOT NULL,
  last_success_at TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'stale', 'unavailable')),
  source_version TEXT,
  UNIQUE (station_code)
);

CREATE TABLE amedas_observation (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES amedas_snapshot(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  element TEXT NOT NULL,
  value_number REAL,
  value_text TEXT,
  quality_flag INTEGER,
  UNIQUE (snapshot_id, observed_at, element)
);
