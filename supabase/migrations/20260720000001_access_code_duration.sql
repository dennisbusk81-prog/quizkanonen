-- Verdikoder: «antall dager» styrer VARIGHET, ikke innløsningsfrist (20. juli 2026)
--
-- Bakgrunn: feltet «antall dager» i admin-panelet skrev kun access_codes.valid_until,
-- altså fristen for å BRUKE koden. Selve premium-tildelingen var alltid permanent.
-- Etter denne migrasjonen er de to konseptene skilt:
--   access_codes.duration_days  → hvor lenge Premium varer etter innløsning (NULL = permanent)
--   access_codes.valid_until    → siste dag koden kan løses inn (NULL = ingen frist)
--
-- Kjøres i Supabase SQL Editor FØR koden deployes.

-- 1. Varighet på koden
ALTER TABLE public.access_codes
  ADD COLUMN IF NOT EXISTS duration_days integer;

COMMENT ON COLUMN public.access_codes.duration_days IS
  'Antall dager Premium varer etter innløsning. NULL = permanent.';

-- 2. Utløpsdato på brukeren.
--    profiles hadde ingen slik kolonne — den gamle RPC-en skrev til
--    stripe_period_end, som kun finnes på organizations. Utløps-parameteren
--    traff derfor ingenting.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS premium_expires_at timestamptz;

COMMENT ON COLUMN public.profiles.premium_expires_at IS
  'Tidspunkt Premium fra verdikode utløper. NULL = ingen tidsbegrensning. '
  'Ryddes av /api/cron/expire-code-premium.';

-- Delvis indeks — cron-jobben spør kun på rader som faktisk har en utløpsdato
CREATE INDEX IF NOT EXISTS profiles_premium_expires_at_idx
  ON public.profiles (premium_expires_at)
  WHERE premium_expires_at IS NOT NULL;

-- 3. RPC-en oppdatert
--    Endringer fra forrige versjon:
--      - skriver premium_expires_at (fantes ikke) i stedet for stripe_period_end
--        (finnes ikke på profiles — den gamle versjonen ville feilet ved reell bruk)
--      - setter premium_source = 'code' i SAMME transaksjon. Ruten satte den
--        tidligere i et separat kall etterpå; feilet det kallet, satt brukeren
--        igjen med Premium som cron-jobben aldri ville funnet.
CREATE OR REPLACE FUNCTION redeem_access_code(
  p_code_id   uuid,
  p_user_id   uuid,
  p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rows_updated int;
BEGIN
  -- Atomisk inkrement kun når det er kapasitet igjen
  UPDATE access_codes
     SET used_count = used_count + 1
   WHERE id = p_code_id
     AND used_count < max_uses;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RAISE EXCEPTION 'code_exhausted';
  END IF;

  -- Gi Premium i samme transaksjon — ingen delvis-feil-vindu
  UPDATE profiles
     SET premium_status     = true,
         premium_since      = NOW(),
         premium_source     = 'code',
         premium_expires_at = p_expires_at
   WHERE id = p_user_id;
END;
$$;
