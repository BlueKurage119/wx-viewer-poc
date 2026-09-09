-- 0012_create_operation_history.sql
-- 操作記録（サーバーが受理・結果確定した制御要求 1 件の記録）

CREATE TABLE operation_history (
  id INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE CHECK (request_id <> ''),
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('start', 'stop', 'force_refresh')),
  target_kind TEXT NOT NULL CHECK (target_kind = 'all'),
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  requested_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  actor_id TEXT CHECK (actor_id IS NULL OR actor_id <> ''),
  actor_display_name TEXT CHECK (actor_display_name IS NULL OR actor_display_name <> ''),
  error_code TEXT CHECK (error_code IS NULL OR error_code <> ''),
  error_message TEXT
);

CREATE INDEX idx_operation_history_completed
  ON operation_history (completed_at DESC, id DESC);
CREATE INDEX idx_operation_history_kind
  ON operation_history (operation_kind, completed_at DESC, id DESC);
CREATE INDEX idx_operation_history_result
  ON operation_history (result, completed_at DESC, id DESC);
