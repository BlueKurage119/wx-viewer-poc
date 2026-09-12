CREATE TABLE telegram_reception_adoption (
  id INTEGER PRIMARY KEY,
  reception_id INTEGER NOT NULL REFERENCES telegram_reception(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL CHECK (venue_id IN ('east', 'trc')),
  adoption_result TEXT CHECK (adoption_result IS NULL OR adoption_result <> ''),
  adoption_reason TEXT,
  adoption_decided_at TEXT,
  UNIQUE (reception_id, venue_id)
);

CREATE INDEX idx_telegram_reception_adoption_pending
  ON telegram_reception_adoption (venue_id, adoption_decided_at, reception_id);
CREATE INDEX idx_telegram_reception_adoption_result
  ON telegram_reception_adoption (venue_id, adoption_result);

INSERT INTO telegram_reception_adoption (
  reception_id, venue_id, adoption_result, adoption_reason, adoption_decided_at
)
SELECT id, 'east', adoption_result, adoption_reason, adoption_decided_at
FROM telegram_reception
WHERE adoption_result IS NOT NULL
   OR adoption_reason IS NOT NULL
   OR adoption_decided_at IS NOT NULL;

ALTER TABLE telegram_reception DROP COLUMN adoption_result;
ALTER TABLE telegram_reception DROP COLUMN adoption_reason;
ALTER TABLE telegram_reception DROP COLUMN adoption_decided_at;
