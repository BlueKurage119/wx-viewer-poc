CREATE TABLE warning_timeseries_value_new (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL,
  block_id TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  kind_code TEXT,
  kind_name TEXT,
  kind_status TEXT NOT NULL,
  kind_datetime TEXT,
  value_category TEXT NOT NULL,
  property_type TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_code TEXT,
  value_text TEXT NOT NULL,
  unit TEXT,
  description TEXT,
  condition TEXT,
  area_division TEXT,
  sequence INTEGER NOT NULL,
  FOREIGN KEY (snapshot_id, block_id, ref_id) REFERENCES warning_timeseries_time_define(snapshot_id, block_id, time_id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES warning_timeseries_snapshot(id) ON DELETE CASCADE
);

INSERT INTO warning_timeseries_value_new (
  id,
  snapshot_id,
  block_id,
  ref_id,
  kind_code,
  kind_name,
  kind_status,
  kind_datetime,
  value_category,
  property_type,
  value_type,
  value_code,
  value_text,
  unit,
  description,
  condition,
  area_division,
  sequence
)
SELECT
  id,
  snapshot_id,
  block_id,
  ref_id,
  kind_code,
  kind_name,
  kind_status,
  NULL,
  value_category,
  property_type,
  value_type,
  NULL,
  value_text,
  unit,
  NULL,
  NULL,
  area_division,
  sequence
FROM warning_timeseries_value;

DROP TABLE warning_timeseries_value;

ALTER TABLE warning_timeseries_value_new RENAME TO warning_timeseries_value;
