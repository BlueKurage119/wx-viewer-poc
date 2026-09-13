CREATE UNIQUE INDEX idx_bosai_bulletin_area_null_info_type
  ON bosai_bulletin_area (bulletin_id, area_code, code_type)
  WHERE information_type IS NULL;

CREATE UNIQUE INDEX idx_bosai_bulletin_area_not_null_info_type
  ON bosai_bulletin_area (bulletin_id, area_code, code_type, information_type)
  WHERE information_type IS NOT NULL;
