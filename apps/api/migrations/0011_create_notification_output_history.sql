-- 0011_create_notification_output_history.sql
-- 通知出力履歴（サーバーが通知として出すと判定した 1 件の記録）

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
