-- ============================================================
-- profiles — e-postpreferanser + admin-suspensjon
--
-- email_reengagement / email_duel_notifications: opt-out-flagg for
-- de respektive transaksjons-e-postene (email_reminders finnes
-- allerede fra 20260401000004 — ikke duplisert her).
--
-- suspended_until: settes av admin-karantene. NULL = ikke suspendert.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_reengagement       boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_duel_notifications boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS suspended_until          timestamptz;
