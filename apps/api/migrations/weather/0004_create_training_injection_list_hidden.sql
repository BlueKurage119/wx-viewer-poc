CREATE TABLE training_injection_list_hidden (
  training_id TEXT PRIMARY KEY REFERENCES training_injection(training_id) ON DELETE CASCADE,
  hidden_at TEXT NOT NULL,
  terminal_id TEXT NOT NULL CHECK (terminal_id <> '')
);
