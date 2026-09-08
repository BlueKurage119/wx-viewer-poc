CREATE TABLE bosai_bulletin (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
  control_status TEXT NOT NULL CHECK (control_status IN ('normal', 'training', 'test')),
  info_type TEXT NOT NULL,
  report_datetime TEXT NOT NULL,
  control_datetime TEXT NOT NULL,
  title TEXT NOT NULL,
  headline_text TEXT NOT NULL,
  information_tag TEXT NOT NULL,
  is_cancelled INTEGER NOT NULL CHECK (is_cancelled IN (0, 1)),
  source TEXT NOT NULL CHECK (source <> ''),
  issued_at TEXT NOT NULL,
  valid_at TEXT,
  valid_from TEXT,
  valid_to TEXT,
  fetched_at TEXT NOT NULL,
  last_success_at TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'stale', 'unavailable')),
  source_version TEXT,
  UNIQUE (event_id, control_status)
);

CREATE TABLE bosai_bulletin_area (
  id INTEGER PRIMARY KEY,
  bulletin_id INTEGER NOT NULL REFERENCES bosai_bulletin(id) ON DELETE CASCADE,
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  code_type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  UNIQUE (bulletin_id, area_code, code_type)
);
