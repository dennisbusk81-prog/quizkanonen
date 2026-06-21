-- B2B-trial: subscription_status styrer tilgang til org-spesifikke sider
-- (bedrifts-leaderboard + admin-panel). Idempotent.
--
-- Verdier:
--   'trialing' — gratis prøveperiode, full tilgang
--   'active'   — betalende kunde, full tilgang
--   'locked'   — trial utløpt uten betaling, org-sidene sperret til betaling
--
-- VIKTIG: Eksisterende rader er allerede betalende kunder uten trial. De settes
-- eksplisitt til 'active' i samme migrasjon slik at ingen mister tilgang når
-- migrasjonen kjøres.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS subscription_status   text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS trial_reminder_sent_at timestamptz;

-- Sett alle eksisterende rader eksplisitt til 'active' (de er allerede betalende).
UPDATE public.organizations
  SET subscription_status = 'active'
  WHERE subscription_status IS NULL OR subscription_status = '';

-- Begrens til gyldige verdier.
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_subscription_status_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_status_check
  CHECK (subscription_status IN ('trialing', 'active', 'locked'));
