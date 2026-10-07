-- 現行最終schemaを所有先ごとに分離する。
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

CREATE TABLE warning_timeseries_snapshot (
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
  source_version TEXT, additions_parsed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (area_code, control_status)
);

CREATE TABLE warning_timeseries_time_define (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES warning_timeseries_snapshot(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  time_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  time_from TEXT NOT NULL,
  time_to TEXT NOT NULL,
  duration TEXT,
  UNIQUE (snapshot_id, block_id, time_id)
);

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
  sequence INTEGER NOT NULL, condition TEXT,
  FOREIGN KEY (snapshot_id, block_id, ref_id) REFERENCES area_timeseries_time_define(snapshot_id, block_id, time_id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES area_timeseries_snapshot(id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, block_id, ref_id, element)
);

CREATE TABLE radar_snapshot (
  id INTEGER PRIMARY KEY,
  product TEXT NOT NULL CHECK (product IN ('N1', 'N2')),
  source TEXT NOT NULL CHECK (source <> ''),
  issued_at TEXT NOT NULL,
  valid_at TEXT,
  valid_from TEXT,
  valid_to TEXT,
  fetched_at TEXT NOT NULL,
  last_success_at TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'stale', 'unavailable')),
  source_version TEXT,
  UNIQUE (product)
);

CREATE TABLE radar_frame (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES radar_snapshot(id) ON DELETE CASCADE,
  base_time TEXT NOT NULL,
  valid_time TEXT NOT NULL,
  element TEXT NOT NULL,
  member TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  UNIQUE (snapshot_id, base_time, valid_time, element, member)
);

CREATE TABLE radar_tile (
  id INTEGER PRIMARY KEY,
  frame_id INTEGER NOT NULL REFERENCES radar_frame(id) ON DELETE CASCADE,
  zoom INTEGER NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  UNIQUE (frame_id, zoom, tile_x, tile_y)
);

CREATE TABLE risk_snapshot (
  id INTEGER PRIMARY KEY,
  layer TEXT NOT NULL CHECK (layer IN ('heavyrain', 'inund', 'land', 'flood')),
  source TEXT NOT NULL CHECK (source <> ''),
  issued_at TEXT NOT NULL,
  valid_at TEXT,
  valid_from TEXT,
  valid_to TEXT,
  fetched_at TEXT NOT NULL,
  last_success_at TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'stale', 'unavailable')),
  source_version TEXT,
  UNIQUE (layer)
);

CREATE TABLE risk_frame (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES risk_snapshot(id) ON DELETE CASCADE,
  base_time TEXT NOT NULL,
  valid_time TEXT NOT NULL,
  image_id TEXT NOT NULL,
  member TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  UNIQUE (snapshot_id, base_time, valid_time, image_id, member)
);

CREATE TABLE risk_tile (
  id INTEGER PRIMARY KEY,
  frame_id INTEGER NOT NULL REFERENCES risk_frame(id) ON DELETE CASCADE,
  zoom INTEGER NOT NULL,
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  UNIQUE (frame_id, zoom, tile_x, tile_y)
);

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
  quality_flag INTEGER, is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (is_estimated IN (0, 1)),
  UNIQUE (snapshot_id, observed_at, element)
);

CREATE TABLE fetch_attempt (
  id INTEGER PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind <> ''),
  target_ref TEXT,
  request_url TEXT NOT NULL CHECK (request_url <> ''),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind <> ''),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  http_status INTEGER,
  response_bytes INTEGER CHECK (response_bytes IS NULL OR response_bytes >= 0),
  item_count INTEGER CHECK (item_count IS NULL OR item_count >= 1),
  failed_item_count INTEGER CHECK (failed_item_count IS NULL OR failed_item_count >= 0) CHECK (item_count IS NULL OR failed_item_count IS NULL OR failed_item_count <= item_count),
  content_hash TEXT,
  error_kind TEXT CHECK (error_kind IS NULL OR error_kind <> ''),
  error_message TEXT
);

CREATE TABLE telegram_reception (
  id INTEGER PRIMARY KEY,
  fetch_attempt_id INTEGER,
  feed_kind TEXT CHECK (feed_kind IS NULL OR feed_kind <> ''),
  feed_entry_id TEXT CHECK (feed_entry_id IS NULL OR feed_entry_id <> ''),
  document_url TEXT NOT NULL CHECK (document_url <> ''),
  telegram_type TEXT CHECK (telegram_type IS NULL OR telegram_type <> ''),
  title TEXT,
  control_status TEXT CHECK (control_status IS NULL OR control_status IN ('normal', 'training', 'test')),
  info_type TEXT,
  event_id TEXT,
  serial TEXT,
  control_datetime TEXT,
  report_datetime TEXT,
  target_datetime TEXT,
  received_at TEXT NOT NULL,
  raw_body TEXT,
  body_bytes INTEGER CHECK (body_bytes IS NULL OR body_bytes >= 0),
  content_hash TEXT
);

CREATE TABLE telegram_reception_area (
  id INTEGER PRIMARY KEY,
  reception_id INTEGER NOT NULL REFERENCES telegram_reception(id) ON DELETE CASCADE,
  area_code TEXT NOT NULL CHECK (area_code <> ''),
  area_name TEXT,
  code_type TEXT,
  sequence INTEGER NOT NULL,
  UNIQUE (reception_id, sequence)
);

CREATE TABLE warning_current_stream (
  id INTEGER PRIMARY KEY,
  prefecture_code TEXT NOT NULL CHECK (prefecture_code <> ''),
  area_code TEXT NOT NULL CHECK (area_code <> ''),
  control_status TEXT NOT NULL CHECK (control_status IN ('normal', 'training', 'test')),
  telegram_type TEXT NOT NULL CHECK (telegram_type IN ('VPWW55', 'VPWW56', 'VPWW57', 'VPWW58', 'VPWW59', 'VPWW60', 'VPWW61', 'VPWS50')),
  reception_id INTEGER NOT NULL,
  report_datetime TEXT NOT NULL,
  control_datetime TEXT NOT NULL,
  received_at TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash <> ''),
  UNIQUE (prefecture_code, area_code, control_status, telegram_type)
);

CREATE TABLE "warning_timeseries_value" (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL,
  block_id TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  kind_code TEXT,
  kind_name TEXT,
  kind_status TEXT NOT NULL,
  kind_datetime TEXT,
  value_category TEXT NOT NULL,
  property_type TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_code TEXT,
  value_text TEXT NOT NULL,
  unit TEXT,
  description TEXT,
  condition TEXT,
  area_division TEXT,
  sequence INTEGER NOT NULL, kind_index INTEGER, property_index INTEGER, part_name TEXT, part_index INTEGER, base_index INTEGER, local_index INTEGER,
  FOREIGN KEY (snapshot_id, block_id, ref_id) REFERENCES warning_timeseries_time_define(snapshot_id, block_id, time_id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES warning_timeseries_snapshot(id) ON DELETE CASCADE
);

CREATE TABLE "bosai_bulletin" (
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
  source_version TEXT, has_sighting INTEGER CHECK (has_sighting IN (0, 1)),
  UNIQUE (event_id, control_status)
);

CREATE TABLE "bosai_bulletin_area" (
  id INTEGER PRIMARY KEY,
  bulletin_id INTEGER NOT NULL REFERENCES bosai_bulletin(id) ON DELETE CASCADE,
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  code_type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  information_type TEXT
);

CREATE TABLE warning_timeseries_addition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES warning_timeseries_snapshot(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  kind_index INTEGER NOT NULL,
  property_index INTEGER NOT NULL,
  part_name TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  base_index INTEGER NOT NULL,
  local_index INTEGER,
  property_type TEXT NOT NULL,
  kind_status TEXT NOT NULL,
  kind_datetime TEXT,
  area_division TEXT,
  addition_index INTEGER NOT NULL,
  note_index INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE telegram_reception_adoption (
  id INTEGER PRIMARY KEY,
  reception_id INTEGER NOT NULL REFERENCES telegram_reception(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL,
  adoption_result TEXT CHECK (adoption_result IS NULL OR adoption_result <> ''),
  adoption_reason TEXT,
  adoption_decided_at TEXT,
  UNIQUE (reception_id, venue_id)
);

CREATE INDEX idx_fetch_attempt_started_at ON fetch_attempt (started_at DESC, id DESC);

CREATE INDEX idx_fetch_attempt_source ON fetch_attempt (source_kind, started_at DESC);

CREATE INDEX idx_fetch_attempt_outcome ON fetch_attempt (outcome, started_at DESC);

CREATE INDEX idx_telegram_reception_received_at ON telegram_reception (received_at DESC, id DESC);

CREATE INDEX idx_telegram_reception_document_url ON telegram_reception (document_url);

CREATE INDEX idx_telegram_reception_type ON telegram_reception (telegram_type, received_at DESC);

CREATE INDEX idx_telegram_reception_control_status ON telegram_reception (control_status, received_at DESC);

CREATE INDEX idx_telegram_reception_report_datetime ON telegram_reception (report_datetime DESC);

CREATE INDEX idx_telegram_reception_fetch_attempt ON telegram_reception (fetch_attempt_id);

CREATE INDEX idx_telegram_reception_area_code ON telegram_reception_area (area_code, reception_id);

CREATE UNIQUE INDEX idx_bosai_bulletin_area_null_info_type
  ON bosai_bulletin_area (bulletin_id, area_code, code_type)
  WHERE information_type IS NULL;

CREATE UNIQUE INDEX idx_bosai_bulletin_area_not_null_info_type
  ON bosai_bulletin_area (bulletin_id, area_code, code_type, information_type)
  WHERE information_type IS NOT NULL;

CREATE INDEX idx_warning_timeseries_addition_snapshot_id
  ON warning_timeseries_addition (snapshot_id);

CREATE INDEX idx_telegram_reception_parse_failure_lookup
  ON telegram_reception (telegram_type, control_status, report_datetime, control_datetime);

CREATE INDEX idx_telegram_reception_warning_recovery
ON telegram_reception (
  control_status,
  telegram_type,
  report_datetime DESC,
  control_datetime DESC,
  id DESC
)
WHERE raw_body IS NOT NULL
  AND report_datetime IS NOT NULL
  AND control_datetime IS NOT NULL;

CREATE INDEX idx_telegram_reception_adoption_pending
  ON telegram_reception_adoption (venue_id, adoption_decided_at, reception_id);

CREATE INDEX idx_telegram_reception_adoption_result
  ON telegram_reception_adoption (venue_id, adoption_result);
