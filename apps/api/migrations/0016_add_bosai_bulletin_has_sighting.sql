ALTER TABLE bosai_bulletin
  ADD COLUMN has_sighting INTEGER CHECK (has_sighting IN (0, 1));
