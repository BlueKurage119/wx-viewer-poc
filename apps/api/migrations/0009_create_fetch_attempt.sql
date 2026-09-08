-- 0009_create_fetch_attempt.sql
-- 通信履歴（取得試行ごとの成否ログ）

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

CREATE INDEX idx_fetch_attempt_started_at ON fetch_attempt (started_at DESC, id DESC);
CREATE INDEX idx_fetch_attempt_source ON fetch_attempt (source_kind, started_at DESC);
CREATE INDEX idx_fetch_attempt_outcome ON fetch_attempt (outcome, started_at DESC);
