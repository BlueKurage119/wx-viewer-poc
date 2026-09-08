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
