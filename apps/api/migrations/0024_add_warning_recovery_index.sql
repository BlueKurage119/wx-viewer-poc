CREATE INDEX idx_telegram_reception_warning_recovery
ON telegram_reception (
  control_status,
  telegram_type,
  report_datetime DESC,
  control_datetime DESC,
  id DESC
)
WHERE raw_body IS NOT NULL
  AND report_datetime IS NOT NULL
  AND control_datetime IS NOT NULL;
