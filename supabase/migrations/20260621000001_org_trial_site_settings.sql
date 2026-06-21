-- Org-trial lengde i dager. Key/value-rad i site_settings, samme mønster som
-- founders-nøklene leses i founders-activate-ruten. Idempotent — endrer ikke
-- en eksisterende verdi hvis raden allerede finnes.
INSERT INTO public.site_settings (key, value)
  VALUES ('org_trial_days', '14')
  ON CONFLICT (key) DO NOTHING;
