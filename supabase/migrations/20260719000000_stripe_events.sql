-- ============================================================
-- stripe_events — idempotens-stempel for Stripe-webhooks
--
-- BAKGRUNN:
-- app/api/stripe/webhook/route.ts har siden starten forsøkt å stemple hver
-- behandlede Stripe-hendelse i denne tabellen. Tabellen har aldri eksistert i
-- databasen — den ble antatt opprettet manuelt, men ble det aldri.
--
-- Insert-en feilet derfor på HVER hendelse. Koden håndterer kun feilkode 23505
-- eksplisitt (unique violation = "allerede behandlet"); alle andre feil logges
-- og ignoreres bevisst for ikke å blokkere Stripe. Nettoeffekten var at
-- idempotens-beskyttelsen aldri har vært aktiv: hver redelivery fra Stripe har
-- reprosessert hele hendelsen, inkludert DB-skrivinger og e-postutsending.
--
-- HVA KODEN FAKTISK TRENGER (verifisert mot route.ts):
--   • INSERT { id: <stripe event-id>, created_at: <ISO-streng> }   (linje 102-104)
--       - id er Stripe sin event-id, f.eks. 'evt_1TjcHpCuFvuZpvNY...' → TEXT
--       - created_at settes eksplisitt av koden → default er kun en sikkerhetsnett
--   • Duplikat MÅ gi feilkode 23505 (unique_violation)             (linje 107)
--       - krever PRIMARY KEY eller UNIQUE på id
--   • DELETE WHERE id = <event-id> ved prosesseringsfeil           (linje 653)
--       - ruller tilbake stempelet så Stripe sin retry slipper til
--   • Ingen SELECT — tabellen leses aldri av appen
--
-- TILGANG:
-- Webhooken skriver via supabaseAdmin (service role), som omgår RLS. RLS
-- aktiveres derfor for å stenge anon/authenticated ute, og SELECT/INSERT/UPDATE/
-- DELETE revokes eksplisitt fra dem. Ingen klient har noe her å gjøre — tabellen
-- er ren infrastruktur. Samme mønster som attempts_lock_to_service_role.sql.
--
-- ⚠️ MERK — DENNE MIGRASJONEN ENDRER OPPFØRSEL:
-- I det tabellen finnes, blir idempotensen aktiv for første gang. Det er
-- ønsket, men det aktiverer samtidig en kjent svakhet: fire tidlige `return`
-- inne i try-blokken (route.ts linje 128, 186, 604, 609) returnerer uten å
-- kaste, så stempelet blir stående og Stripe sin retry avvises som duplikat
-- uten å prosessere. Hendelser som treffer de fire linjene blir dermed
-- permanent tapt i stedet for å retryes. Bør rettes i egen økt.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stripe_events (
  -- Stripe sin event-id. PRIMARY KEY gir unique-indeksen koden er avhengig av:
  -- et forsøk på å stemple samme hendelse to ganger gir 23505.
  id          text        PRIMARY KEY,
  -- Settes eksplisitt av webhooken; default her er kun sikkerhetsnett.
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Opprydding av gamle stempler er ikke nødvendig for korrekthet (id-ene er
-- unike for alltid), men holder tabellen liten. Indeks på created_at gjør en
-- eventuell fremtidig opprydding billig.
CREATE INDEX IF NOT EXISTS stripe_events_created_at_idx
  ON public.stripe_events (created_at);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- Ingen policyer for anon/authenticated = ingen tilgang for dem.
-- Eksplisitte service_role-policyer for lesbarhet og symmetri med resten av basen.
DROP POLICY IF EXISTS "Service role kan sette inn stripe_events" ON public.stripe_events;
CREATE POLICY "Service role kan sette inn stripe_events"
  ON public.stripe_events FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role kan slette stripe_events" ON public.stripe_events;
CREATE POLICY "Service role kan slette stripe_events"
  ON public.stripe_events FOR DELETE
  TO service_role
  USING (true);

-- Belte og bukseseler: fjern eventuelle implisitte grants til klientrollene.
REVOKE ALL ON public.stripe_events FROM anon, authenticated;

-- PostgREST cacher skjemaet. Uten denne kan tabellen forbli "usynlig" for
-- supabase-js en stund etter opprettelse — nøyaktig symptomet som gjorde at
-- feilen var vanskelig å oppdage ("Could not find the table in the schema cache").
NOTIFY pgrst, 'reload schema';
