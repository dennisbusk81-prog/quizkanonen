-- ============================================================
-- Verdikoder: kodetype + innløsning per konto (26. juli 2026)
--
-- FORMÅL
-- Verdikoder har to helt ulike sikkerhetsmodeller, og systemet skilte dem ikke:
--
--   DELT KODE (f.eks. en belønning til hele Facebook-gruppa på 455 medlemmer)
--     Skal være lesbar og minneverdig, og er MENT å deles åpent. Gjettbarhet
--     beskytter den ikke — den er per definisjon kjent av mange. Det som
--     beskytter den er BRUKSGRENSER: maks antall innløsninger, utløpsdato, og
--     én innløsning per konto.
--
--   PRIVAT KODE (f.eks. premie til én konkurransevinner)
--     Skal IKKE kunne gjettes av utenforstående. Her er høy entropi riktig
--     forsvar, og koden genereres tilfeldig (se lib/access-code.ts).
--
-- Denne migrasjonen gir databasen begge modellene:
--   1. access_codes.code_type — hvilken modell koden følger
--   2. access_code_redemptions — hvem som har løst inn hva (per-konto-sperren)
--   3. redeem_access_code() utvidet med per-konto-sjekken, i samme transaksjon
--
-- Kjøres i Supabase SQL Editor FØR koden deployes: uten kolonnen code_type
-- feiler admin-opprettelsen av nye koder (PGRST204). Innløsning av
-- EKSISTERENDE koder er upåvirket av rekkefølgen.
--
-- Idempotent — trygg å kjøre om igjen.
-- ============================================================

-- ── 1. Kodetype ──────────────────────────────────────────────────────────────
-- Eksisterende rader får 'shared'. Det er riktig for FREDAG2025, som var en
-- bred betatester-/goodwill-kode (200 plasser).
ALTER TABLE public.access_codes
  ADD COLUMN IF NOT EXISTS code_type text NOT NULL DEFAULT 'shared';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_codes_code_type_check'
  ) THEN
    ALTER TABLE public.access_codes
      ADD CONSTRAINT access_codes_code_type_check
      CHECK (code_type IN ('shared', 'personal'));
  END IF;
END $$;

COMMENT ON COLUMN public.access_codes.code_type IS
  'shared = lesbar kode ment for bred deling, beskyttet av bruksgrenser. '
  'personal = tilfeldig generert kode til én mottaker, beskyttet av entropi.';

-- ── 2. Innløsninger per konto ────────────────────────────────────────────────
-- Uten denne tabellen var det ingenting som hindret at SAMME bruker løste inn
-- SAMME delte kode flere ganger: sperren i redeem-ruten er
-- `premium_status === true`, og den faller bort når kode-premium utløper
-- (profiles.premium_expires_at + /api/cron/expire-code-premium). Én bruker
-- kunne dermed spise flere av de N plassene på en gruppekode.
CREATE TABLE IF NOT EXISTS public.access_code_redemptions (
  id           uuid primary key default gen_random_uuid(),
  code_id      uuid not null references public.access_codes(id) on delete cascade,
  user_id      uuid not null,
  redeemed_at  timestamptz not null default now()
);

-- Selve per-konto-sperren. UNIQUE-indeksen er håndhevingen; sjekken i
-- funksjonen under er bare det som gjør feilmeldingen lesbar.
CREATE UNIQUE INDEX IF NOT EXISTS access_code_redemptions_code_user_unique
  ON public.access_code_redemptions (code_id, user_id);

-- Oppslag «hvilke koder har denne brukeren løst inn» (framtidig gavekode-UI).
CREATE INDEX IF NOT EXISTS access_code_redemptions_user_idx
  ON public.access_code_redemptions (user_id);

-- RLS: kun service_role, samme mønster som org_trial_codes. Ingen policies =
-- ingen tilgang for anon/authenticated; service_role omgår RLS.
ALTER TABLE public.access_code_redemptions ENABLE ROW LEVEL SECURITY;

-- ── 3. RPC med per-konto-sperre ──────────────────────────────────────────────
-- Rekkefølgen er bevisst: innløsningsraden settes inn FØRST. Da avvises et
-- gjentatt forsøk fra samme konto før used_count økes, slik at et avvist forsøk
-- aldri brenner en plass på koden.
--
-- Hele funksjonen er én transaksjon: enten registreres innløsningen, telleren
-- økes og Premium gis — eller ingenting skjer.
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
  -- Én innløsning per konto per kode
  INSERT INTO access_code_redemptions (code_id, user_id)
  VALUES (p_code_id, p_user_id)
  ON CONFLICT (code_id, user_id) DO NOTHING;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RAISE EXCEPTION 'already_redeemed';
  END IF;

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
