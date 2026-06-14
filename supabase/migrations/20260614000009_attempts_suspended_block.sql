-- ============================================================
-- attempts — hard server-side sperre for suspenderte brukere
--
-- suspended_until på profiles ble tidligere kun sjekket klient-side i
-- quiz-siden. En suspendert bruker kunne omgå UI og sende inn attempts
-- direkte via Supabase-klienten.
--
-- VIKTIG ARKITEKTUR-MERKNAD:
-- Attempts settes inn via `supabaseData` — en anon-klient uten sesjon
-- (persistSession: false, ingen Authorization-header, se lib/supabase.ts).
-- Forespørselen kommer derfor inn som rollen `anon`, og `auth.uid()` er
-- NULL selv for innloggede spillere (user_id settes som kolonneverdi i
-- payloaden, ikke via auth). En `auth.uid()`-basert policy ville derfor
-- aldri matche og ikke blokkere noe.
--
-- Derfor sjekker vi den NYE radens user_id-kolonne mot profiles
-- istedenfor auth.uid(). Dette blokkerer den realistiske bypass-en
-- (å spille av det vanlige klient-kallet med eget user_id). Anonyme
-- forsøk (user_id NULL) er upåvirket.
--
-- Det finnes allerede en permissiv INSERT-policy "attempts_insert_all"
-- (WITH CHECK true) fra 20260401000001. RLS-policyer kombineres med OR,
-- så en ny restriktiv policy ved siden av ville blitt omgått. Vi ERSTATTER
-- derfor den permissive policyen med én som inkluderer suspensjons-sjekken.
-- Idempotent: DROP POLICY IF EXISTS før CREATE.
-- ============================================================

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attempts_insert_all" ON public.attempts;
DROP POLICY IF EXISTS "Suspenderte brukere kan ikke spille" ON public.attempts;

CREATE POLICY "Suspenderte brukere kan ikke spille"
  ON public.attempts FOR INSERT
  WITH CHECK (
    user_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = attempts.user_id
        AND profiles.suspended_until > now()
    )
  );
