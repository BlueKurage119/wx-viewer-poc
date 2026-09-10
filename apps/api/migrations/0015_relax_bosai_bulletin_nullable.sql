CREATE TABLE bosai_bulletin_new (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
  control_status TEXT NOT NULL CHECK (control_status IN ('normal', 'training', 'test')),
  info_type TEXT NOT NULL,
  report_datetime TEXT NOT NULL,
  control_datetime TEXT NOT NULL,
  title TEXT NOT NULL,
  headline_text TEXT,
  information_tag TEXT,
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

INSERT INTO bosai_bulletin_new (
  id,
  event_id,
  control_status,
  info_type,
  report_datetime,
  control_datetime,
  title,
  headline_text,
  information_tag,
  is_cancelled,
  source,
  issued_at,
  valid_at,
  valid_from,
  valid_to,
  fetched_at,
  last_success_at,
  availability,
  source_version
)
SELECT
  id,
  event_id,
  control_status,
  info_type,
  report_datetime,
  control_datetime,
  title,
  headline_text,
  information_tag,
  is_cancelled,
  source,
  issued_at,
  valid_at,
  valid_from,
  valid_to,
  fetched_at,
  last_success_at,
  availability,
  source_version
FROM bosai_bulletin;

CREATE TABLE bosai_bulletin_area_new (
  id INTEGER PRIMARY KEY,
  bulletin_id INTEGER NOT NULL REFERENCES bosai_bulletin_new(id) ON DELETE CASCADE,
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  code_type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  UNIQUE (bulletin_id, area_code, code_type)
);

INSERT INTO bosai_bulletin_area_new (
  id,
  bulletin_id,
  area_code,
  area_name,
  code_type,
  sequence
)
SELECT
  id,
  bulletin_id,
  area_code,
  area_name,
  code_type,
  sequence
FROM bosai_bulletin_area;

DROP TABLE bosai_bulletin_area;
DROP TABLE bosai_bulletin;

ALTER TABLE bosai_bulletin_new RENAME TO bosai_bulletin;
ALTER TABLE bosai_bulletin_area_new RENAME TO bosai_bulletin_area;
