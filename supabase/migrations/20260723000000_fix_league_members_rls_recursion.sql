-- ============================================================
-- FIX: uendelig rekursjon i RLS-policy for league_members (42P17)
--
-- Problem (funnet 23. juli 2026, reprodusert mot prod):
--   Policyen "league_members_select_comembers" (fra 20260521) spør
--   league_members om seg selv i USING-uttrykket:
--       league_id IN (SELECT league_id FROM league_members WHERE user_id = auth.uid())
--   Når Postgres evaluerer policyen leser subqueryen league_members på
--   nytt → samme policy → uendelig rekursjon → feil 42P17.
--
--   Følgene rammer ALL klient-lesing (anon/authenticated, ikke service_role):
--     • league_members  → 500 42P17
--     • leagues          → 500 42P17 (dens policy leser league_members)
--     • season_scores    → 500 42P17 (read_league_season_scores har
--                          EXISTS(SELECT … FROM league_members …))
--   Server-API-ene overlever fordi de bruker service_role (omgår RLS).
--   Har vært ødelagt siden 21. mai 2026.
--
-- Fiks (standard Supabase-mønster):
--   En SECURITY DEFINER-funksjon leser league_members SOM eier (postgres,
--   BYPASSRLS), slik at det indre oppslaget IKKE trigger policyen på nytt.
--   auth.uid() fungerer fortsatt inne i en definer-funksjon (den leser
--   request-JWT-claims, ikke den kjørende rollen). Policyen kaller funksjonen
--   i stedet for å self-joine → ingen rekursjon.
--
--   search_path = '' (tom): funksjonen kjører med definer-rettigheter, så
--   stien fastsettes her og arves ALDRI fra kalleren — det nøytraliserer
--   search_path-injection. Tom (ikke 'public') er den hardeste formen fordi
--   kroppen allerede er fullkvalifisert (public.league_members, auth.uid());
--   ingenting resolves implisitt, så selv den teoretiske resten forsvinner.
--   pg_catalog er uansett alltid implisitt først, så innebygde operatorer
--   (=, EXISTS) er trygge.
--
--   Å fikse league_members' EGEN policy er nok: leagues og season_scores
--   rekurserer bare fordi de leser league_members, hvis policy nå er trygg.
--
-- MERK: Kjøres manuelt i Supabase SQL Editor (som postgres → funksjonen får
--   riktig eier). Ikke destruktiv, idempotent. Rører kun én policy + én ny
--   funksjon + én indeks. Ingen data endres.
-- ============================================================

-- 1) SECURITY DEFINER-hjelper: sjekker om innlogget bruker er medlem av en
--    liga, uten å trigge RLS på league_members (kjører som funksjonens eier).
CREATE OR REPLACE FUNCTION public.is_league_member(p_league_id uuid)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = ''
  STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.league_members
    WHERE  league_id = p_league_id
      AND  user_id   = auth.uid()
  );
$$;

-- 2) Erstatt den self-refererende policyen med en som kaller hjelperen.
DROP POLICY IF EXISTS "league_members_select_comembers" ON public.league_members;

CREATE POLICY "league_members_select_comembers"
  ON public.league_members FOR SELECT
  USING ( public.is_league_member(league_id) );

-- 3) Bonus: indeks på league_members(user_id) — hjelperen (og den gamle
--    policyen) filtrerer på user_id. Trygt/idempotent uansett.
CREATE INDEX IF NOT EXISTS idx_league_members_user_id
  ON public.league_members (user_id);

-- ── Etter kjøring, verifiser i SQL Editor at disse nå gir rader/0 (ikke 42P17):
--    SELECT count(*) FROM league_members;
--    SELECT count(*) FROM leagues;
--    SELECT count(*) FROM season_scores WHERE scope_type = 'global';
