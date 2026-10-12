CREATE TABLE training_injection (
  training_id TEXT PRIMARY KEY CHECK (length(training_id) = 36),
  terminal_id TEXT NOT NULL CHECK (terminal_id <> ''),
  requested_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  finished_at TEXT,
  telegram_count INTEGER NOT NULL CHECK (telegram_count BETWEEN 1 AND 20), -- 要求電文の数（基準電文を含まない）
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  error_code TEXT CHECK (error_code IS NULL OR error_code <> '')
);
CREATE TABLE training_injection_reception (
  training_id TEXT NOT NULL REFERENCES training_injection(training_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  reception_id INTEGER NOT NULL UNIQUE REFERENCES telegram_reception(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('requested', 'baseline')),
  preview_id TEXT CHECK (preview_id IS NULL OR preview_id <> ''),
  telegram_type TEXT NOT NULL CHECK (telegram_type <> ''),
  PRIMARY KEY (training_id, sequence),
  CHECK ((role = 'baseline') = (preview_id IS NULL)),
  CHECK (role <> 'baseline' OR (sequence = 0 AND telegram_type = 'VPWS50'))
);
