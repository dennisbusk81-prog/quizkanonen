-- ============================================================
-- organizations — org-spesifikke quiz-tidspunkter (B2B)
--
-- Lar bedrifter sette egne åpne-/stengetider for ukens quiz,
-- samt hvilken quiz close-reminder-e-posten gjelder.
-- Dokumenterer kolonner kjørt manuelt i B2B-økten.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS org_quiz_opens_at         TIME,
  ADD COLUMN IF NOT EXISTS org_quiz_closes_at        TIME,
  ADD COLUMN IF NOT EXISTS org_close_reminder_quiz_id TEXT;
