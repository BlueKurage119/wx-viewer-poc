CREATE TABLE training_retraction (
  retraction_id TEXT PRIMARY KEY CHECK (length(retraction_id) = 36),
  scope TEXT NOT NULL CHECK (scope IN ('training', 'all')),
  terminal_id TEXT NOT NULL CHECK (terminal_id <> ''),
  requested_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  error_code TEXT CHECK (error_code IS NULL OR error_code <> '')
);
CREATE TABLE training_retraction_target (
  retraction_id TEXT NOT NULL REFERENCES training_retraction(retraction_id) ON DELETE CASCADE,
  training_id TEXT NOT NULL REFERENCES training_injection(training_id) ON DELETE CASCADE,
  PRIMARY KEY (retraction_id, training_id)
);
CREATE TABLE training_retraction_item (
  retraction_id TEXT NOT NULL REFERENCES training_retraction(retraction_id) ON DELETE CASCADE,
  item_no INTEGER NOT NULL CHECK (item_no >= 0),
  target_reception_id INTEGER NOT NULL REFERENCES telegram_reception(id) ON DELETE CASCADE,
  telegram_type TEXT NOT NULL CHECK (telegram_type <> ''),
  outcome TEXT NOT NULL CHECK (outcome IN ('cancelled', 'superseded', 'already_cancelled', 'baseline_not_owned')),
  cancel_reception_id INTEGER UNIQUE REFERENCES telegram_reception(id) ON DELETE CASCADE,
  PRIMARY KEY (retraction_id, item_no),
  CHECK ((outcome = 'cancelled') = (cancel_reception_id IS NOT NULL))
);
