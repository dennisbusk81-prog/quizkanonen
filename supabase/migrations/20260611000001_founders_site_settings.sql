-- Legg til founders-kolonner i site_settings
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS founders_max_slots  integer DEFAULT 250,
  ADD COLUMN IF NOT EXISTS founders_days_free  integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS founders_trial_days integer DEFAULT 7;
