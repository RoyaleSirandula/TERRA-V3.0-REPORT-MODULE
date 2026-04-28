-- Movebank integration: link a Movebank study to a report
-- Run once against terra_db:  psql -U postgres -d terra_db -f scripts/movebank_migration.sql

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS movebank_study_id TEXT,
  ADD COLUMN IF NOT EXISTS movebank_config    JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_reports_movebank_study
  ON reports (movebank_study_id)
  WHERE movebank_study_id IS NOT NULL;
