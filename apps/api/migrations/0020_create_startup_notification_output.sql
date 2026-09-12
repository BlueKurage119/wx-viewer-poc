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

CREATE INDEX idx_startup_notification_inquiry_time
  ON startup_notification_inquiry (inquired_at DESC, id DESC);
