-- ============================================================
-- Premium-kildemodell: kode-perioden blir autoritativ (26. juli 2026)
--
-- KJØRES ETTER 20260732000000_access_code_types_and_redemptions.sql
--
-- FORMÅL
-- Premium kan komme fra fire kilder (verdikode, Founders-trial, personlig
-- Stripe-abonnement, org-medlemskap), men profiles lagret bare ÉN av dem i
-- premium_source. En bruker kan reelt ha flere samtidig — typisk et betalt
-- abonnement OG en kode — og da mistet modellen informasjon:
--
--   • webhooken overskriver premium_source ved enhver abonnementshendelse, så
--     sporet av at en kode fortsatt gjaldt forsvant
--   • cron-ene slo av Premium uten å spørre om noen annen kilde dekket brukeren
--
-- Løsningen er å gjøre INNLØSNINGSRADEN autoritativ for kode-perioden. Den røres
-- ikke av Stripe-hendelser, og lib/premium-state.ts utleder full tilstand fra
-- den + org-medlemskap + levende Stripe-abonnement.
--
-- profiles.premium_status/premium_source/premium_expires_at beholdes som cache
-- for raske spørringer, skrevet av syncPremiumCache().
--
-- Idempotent — trygg å kjøre om igjen.
-- ============================================================

-- ── 1. Kode-perioden på innløsningsraden ─────────────────────────────────────
-- NULL = permanent kode (duration_days er ikke satt på koden).
ALTER TABLE public.access_code_redemptions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

COMMENT ON COLUMN public.access_code_redemptions.expires_at IS
  'Slutt på kode-perioden. NULL = permanent. Autoritativ kilde for «har brukeren '
  'en aktiv kode» — i motsetning til profiles.premium_expires_at, som er cache '
  'og kan bli overskrevet av Stripe-webhooken.';

-- Oppslaget lib/premium-state-io.ts gjør ved hver innløsning og hver
-- premium-rekalkulering: «har denne brukeren en kode som fortsatt gjelder».
CREATE INDEX IF NOT EXISTS access_code_redemptions_user_active_idx
  ON public.access_code_redemptions (user_id, expires_at);

-- ── 2. RPC lagrer perioden på innløsningsraden ───────────────────────────────
-- Signaturen er uendret. p_expires_at beregnes nå av ruten (stabling oppå
-- eksisterende Founders-/abonnementsdekning) i stedet for alltid å være
-- «nå + varighet», og skrives BÅDE på innløsningsraden (autoritativ) og på
-- profiles (cache).
--
-- Rekkefølgen i funksjonen er uendret fra 20260732000000: innløsningsraden
-- settes inn først, slik at et gjentatt forsøk fra samme konto avvises før
-- used_count økes og aldri brenner en plass på koden.
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
  INSERT INTO access_code_redemptions (code_id, user_id, expires_at)
  VALUES (p_code_id, p_user_id, p_expires_at)
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

  -- Gi Premium i samme transaksjon — ingen delvis-feil-vindu.
  -- premium_status settes true her; syncPremiumCache() i applikasjonen holder
  -- feltene i tråd med den utledede tilstanden fra da av.
  UPDATE profiles
     SET premium_status     = true,
         premium_since      = NOW(),
         premium_source     = 'code',
         premium_expires_at = p_expires_at
   WHERE id = p_user_id;
END;
$$;

-- ── 3. MERK: backfill av personal_stripe_subscription_id ─────────────────────
-- Kolonnen settes i dag KUN av Founders-flyten, men brukes fire steder som om
-- den betydde «har ikke eget abonnement» (begge cron-ene og begge
-- org-grace-stedene). For en vanlig betalende B2C-kunde er den NULL, og de
-- fire stedene tar da feil beslutning.
--
-- Webhooken skriver den nå ved checkout.session.completed, men eksisterende
-- rader må fylles fra Stripe — det krever API-kall og kan ikke gjøres i SQL.
-- Kjør scripts/backfill-personal-subscription-id.mjs (read-only dry-run som
-- standard) etter at denne migrasjonen er kjørt.
