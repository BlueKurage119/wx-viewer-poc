ALTER TABLE telegram_reception_adoption RENAME TO telegram_reception_adoption_legacy;

CREATE TABLE telegram_reception_adoption (
  id INTEGER PRIMARY KEY,
  reception_id INTEGER NOT NULL REFERENCES telegram_reception(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL,
  adoption_result TEXT CHECK (adoption_result IS NULL OR adoption_result <> ''),
  adoption_reason TEXT,
  adoption_decided_at TEXT,
  UNIQUE (reception_id, venue_id)
);

INSERT INTO telegram_reception_adoption (id, reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at)
SELECT id, reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at
FROM telegram_reception_adoption_legacy;

DROP TABLE telegram_reception_adoption_legacy;

CREATE INDEX idx_telegram_reception_adoption_pending
  ON telegram_reception_adoption (venue_id, adoption_decided_at, reception_id);
CREATE INDEX idx_telegram_reception_adoption_result
  ON telegram_reception_adoption (venue_id, adoption_result);
