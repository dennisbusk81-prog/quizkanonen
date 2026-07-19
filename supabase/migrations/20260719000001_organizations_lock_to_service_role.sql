-- ============================================================
-- organizations — lås SELECT til service_role
--
-- BAKGRUNN:
-- Policyen "organizations_select_all" (SELECT, USING true) ble opprettet i
-- 20260401000000_create_auth_tables.sql og har aldri blitt strammet inn. Den lot
-- hvem som helst med den offentlige anon-nøkkelen lese HELE organizations-
-- tabellen uten å være innlogget — inkludert:
--
--   stripe_customer_id, stripe_subscription_id, stripe_period_end,
--   subscription_status, plan, created_by
--
-- Altså Stripe-identifikatorer for samtlige bedriftskunder, tilgjengelig for en
-- hvilken som helst besøkende. Bekreftet live 19. juli 2026: et anon-kall
-- returnerte alle rader med alle kolonner.
--
-- VERIFISERT FØR ENDRING:
-- Alle 48 kodesteder som leser fra organizations ligger i app/api/** eller lib/**
-- og bruker supabaseAdmin (service role). Det eneste treffet i en .tsx-fil er
-- app/page.tsx:1068 — en embedded join (organization_members → organizations),
-- men den kjører i en SERVER-komponent via supabaseAdmin, ikke anon-nøkkelen.
-- Ingen klientside-kode leser tabellen. Låsen er derfor risikofri.
--
-- ETTER DENNE MIGRASJONEN:
--   • SELECT: kun service_role (via server-rutene, som allerede er eneste bruker)
--   • INSERT/UPDATE/DELETE: uendret — det fantes aldri policyer for disse, så de
--     var allerede service_role-only
--
-- Samme mønster som attempts_lock_to_service_role.sql: DROP av den åpne policyen,
-- eksplisitt service_role-policy for lesbarhet, og REVOKE av grants slik at
-- klientrollene avvises på grant-nivå (42501) og ikke bare får et tomt svar.
--
-- Idempotent: DROP POLICY IF EXISTS før CREATE.
-- ============================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Fjern den åpne SELECT-policyen (dette er selve fiksen)
DROP POLICY IF EXISTS "organizations_select_all" ON public.organizations;

-- Ny SELECT: kun service-role. Service role omgår RLS uansett, så policyen er
-- primært dokumenterende — det er REVOKE under som stenger klientrollene ute.
DROP POLICY IF EXISTS "Service role kan lese organizations" ON public.organizations;
CREATE POLICY "Service role kan lese organizations"
  ON public.organizations FOR SELECT
  TO service_role
  USING (true);

-- Belte og bukseseler: fjern grants til klientrollene, slik at et anon-forsøk
-- avvises med 42501 permission denied i stedet for å returnere tomt.
REVOKE ALL ON public.organizations FROM anon, authenticated;

-- PostgREST cacher skjema og policyer.
NOTIFY pgrst, 'reload schema';
