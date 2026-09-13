-- 0023_add_warning_timeseries_addition_and_scope.sql
-- Issue #34 時系列付加事項(Addition/Note)およびscope列の追加、ならびにIssue #33-#35鮮度評価用インデックス

ALTER TABLE warning_timeseries_snapshot ADD COLUMN additions_parsed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE warning_timeseries_value ADD COLUMN kind_index INTEGER;
ALTER TABLE warning_timeseries_value ADD COLUMN property_index INTEGER;
ALTER TABLE warning_timeseries_value ADD COLUMN part_name TEXT;
ALTER TABLE warning_timeseries_value ADD COLUMN part_index INTEGER;
ALTER TABLE warning_timeseries_value ADD COLUMN base_index INTEGER;
ALTER TABLE warning_timeseries_value ADD COLUMN local_index INTEGER;

CREATE TABLE warning_timeseries_addition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES warning_timeseries_snapshot(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  kind_index INTEGER NOT NULL,
  property_index INTEGER NOT NULL,
  part_name TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  base_index INTEGER NOT NULL,
  local_index INTEGER,
  property_type TEXT NOT NULL,
  kind_status TEXT NOT NULL,
  kind_datetime TEXT,
  area_division TEXT,
  addition_index INTEGER NOT NULL,
  note_index INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX idx_warning_timeseries_addition_snapshot_id
  ON warning_timeseries_addition (snapshot_id);

CREATE INDEX idx_telegram_reception_parse_failure_lookup
  ON telegram_reception (telegram_type, control_status, report_datetime, control_datetime);

CREATE INDEX idx_telegram_reception_adoption_parse_failure
  ON telegram_reception_adoption (venue_id, adoption_result, reception_id);
