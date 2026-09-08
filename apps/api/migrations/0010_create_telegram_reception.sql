-- 0010_create_telegram_reception.sql
-- 電文履歴（XML 電文 1 件ごとの受信記録）および対象地域明細

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
  adoption_result TEXT CHECK (adoption_result IS NULL OR adoption_result <> ''),
  adoption_reason TEXT,
  adoption_decided_at TEXT,
  raw_body TEXT,
  body_bytes INTEGER CHECK (body_bytes IS NULL OR body_bytes >= 0),
  content_hash TEXT
);

CREATE INDEX idx_telegram_reception_received_at ON telegram_reception (received_at DESC, id DESC);
CREATE INDEX idx_telegram_reception_document_url ON telegram_reception (document_url);
CREATE INDEX idx_telegram_reception_type ON telegram_reception (telegram_type, received_at DESC);
CREATE INDEX idx_telegram_reception_control_status ON telegram_reception (control_status, received_at DESC);
CREATE INDEX idx_telegram_reception_report_datetime ON telegram_reception (report_datetime DESC);
CREATE INDEX idx_telegram_reception_fetch_attempt ON telegram_reception (fetch_attempt_id);

CREATE TABLE telegram_reception_area (
  id INTEGER PRIMARY KEY,
  reception_id INTEGER NOT NULL REFERENCES telegram_reception(id) ON DELETE CASCADE,
  area_code TEXT NOT NULL CHECK (area_code <> ''),
  area_name TEXT,
  code_type TEXT,
  sequence INTEGER NOT NULL,
  UNIQUE (reception_id, sequence)
);

CREATE INDEX idx_telegram_reception_area_code ON telegram_reception_area (area_code, reception_id);
