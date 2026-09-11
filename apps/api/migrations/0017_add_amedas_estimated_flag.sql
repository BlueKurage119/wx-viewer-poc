ALTER TABLE amedas_observation
  ADD COLUMN is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (is_estimated IN (0, 1));
