-- 現行最終schemaを所有先ごとに分離する。
CREATE TABLE notification_output_history (
  id INTEGER PRIMARY KEY,
  notification_id TEXT NOT NULL UNIQUE CHECK (notification_id <> ''),
  category TEXT NOT NULL CHECK (category <> ''),
  source_type TEXT NOT NULL CHECK (source_type <> ''),
  source_version TEXT CHECK (source_version IS NULL OR source_version <> ''),
  target_area_json TEXT CHECK (target_area_json IS NULL OR target_area_json <> ''),
  occurred_at TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type <> ''),
  ack_required INTEGER NOT NULL CHECK (ack_required IN (0, 1)),
  summary TEXT NOT NULL CHECK (summary <> ''),
  related_refs_json TEXT NOT NULL CHECK (related_refs_json <> ''),
  origin TEXT NOT NULL CHECK (origin IN ('weather', 'system')),
  detection_context TEXT NOT NULL CHECK (detection_context IN ('normal', 'initial')),
  is_training INTEGER NOT NULL CHECK (is_training IN (0, 1)),
  message_definition_id TEXT CHECK (message_definition_id IS NULL OR message_definition_id <> ''),
  message_definition_version TEXT CHECK (message_definition_version IS NULL OR message_definition_version <> ''),
  CHECK (
    (message_definition_id IS NULL AND message_definition_version IS NULL)
    OR
    (message_definition_id IS NOT NULL AND message_definition_version IS NOT NULL)
  )
);

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

CREATE TABLE terminal_session (
  session_id TEXT PRIMARY KEY NOT NULL,
  first_inquired_at TEXT NOT NULL
);

CREATE TABLE startup_warning_claim (
  server_generation_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (server_generation_id, venue_id)
);

CREATE TABLE startup_notification_inquiry (
  id INTEGER PRIMARY KEY,
  server_generation_id TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_kind TEXT NOT NULL CHECK (session_kind IN ('startup', 'continuation')),
  inquired_at TEXT NOT NULL,
  warning_claimed INTEGER NOT NULL CHECK (warning_claimed IN (0, 1)),
  response_json TEXT NOT NULL CHECK (response_json <> '')
);

CREATE INDEX idx_notification_output_history_detected
  ON notification_output_history (detected_at DESC, id DESC);

CREATE INDEX idx_notification_output_history_category
  ON notification_output_history (category, detected_at DESC, id DESC);

CREATE INDEX idx_notification_output_history_source
  ON notification_output_history (source_type, detected_at DESC, id DESC);

CREATE INDEX idx_notification_output_history_origin
  ON notification_output_history (origin, detected_at DESC, id DESC);

CREATE INDEX idx_notification_output_history_context
  ON notification_output_history (detection_context, detected_at DESC, id DESC);

CREATE INDEX idx_notification_output_history_training
  ON notification_output_history (is_training, detected_at DESC, id DESC);

CREATE INDEX idx_operation_history_completed
  ON operation_history (completed_at DESC, id DESC);

CREATE INDEX idx_operation_history_kind
  ON operation_history (operation_kind, completed_at DESC, id DESC);

CREATE INDEX idx_operation_history_result
  ON operation_history (result, completed_at DESC, id DESC);

CREATE INDEX idx_startup_notification_inquiry_time
  ON startup_notification_inquiry (inquired_at DESC, id DESC);

ALTER TABLE notification_output_history ADD COLUMN weather_database_generation_id TEXT;
