CREATE TABLE bosai_bulletin_area_new (
  id INTEGER PRIMARY KEY,
  bulletin_id INTEGER NOT NULL REFERENCES bosai_bulletin(id) ON DELETE CASCADE,
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  code_type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  information_type TEXT
);

INSERT INTO bosai_bulletin_area_new (
  id,
  bulletin_id,
  area_code,
  area_name,
  code_type,
  sequence,
  information_type
)
SELECT
  id,
  bulletin_id,
  area_code,
  area_name,
  code_type,
  sequence,
  NULL
FROM bosai_bulletin_area;

DROP TABLE bosai_bulletin_area;
ALTER TABLE bosai_bulletin_area_new RENAME TO bosai_bulletin_area;
