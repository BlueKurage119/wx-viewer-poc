CREATE TABLE warning_current_stream (
  id INTEGER PRIMARY KEY,
  prefecture_code TEXT NOT NULL CHECK (prefecture_code <> ''),
  area_code TEXT NOT NULL CHECK (area_code <> ''),
  control_status TEXT NOT NULL CHECK (control_status IN ('normal', 'training', 'test')),
  telegram_type TEXT NOT NULL CHECK (telegram_type IN ('VPWW55', 'VPWW56', 'VPWW57', 'VPWW58', 'VPWW59', 'VPWW60', 'VPWW61', 'VPWS50')),
  reception_id INTEGER NOT NULL,
  report_datetime TEXT NOT NULL,
  control_datetime TEXT NOT NULL,
  received_at TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash <> ''),
  UNIQUE (prefecture_code, area_code, control_status, telegram_type)
);
