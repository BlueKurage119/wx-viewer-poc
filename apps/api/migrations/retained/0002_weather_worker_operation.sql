-- 取得Worker再開の専用台帳。通常の取得開始・停止とは分離する。
CREATE TABLE weather_worker_operation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('acquisition', 'delivery')),
  expected_worker_generation TEXT NOT NULL,
  new_worker_generation TEXT,
  server_generation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  result TEXT CHECK (result IN ('success', 'failure', 'unknown')),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  desired_running INTEGER CHECK (desired_running IN (0, 1)),
  CHECK (
    (status = 'in_progress' AND result IS NULL AND completed_at IS NULL
      AND new_worker_generation IS NULL AND error_code IS NULL AND error_message IS NULL)
    OR
    (status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL
      AND ((result = 'success' AND new_worker_generation IS NOT NULL AND error_code IS NULL AND error_message IS NULL)
        OR (result IN ('failure', 'unknown') AND error_code IS NOT NULL)))
  )
);
