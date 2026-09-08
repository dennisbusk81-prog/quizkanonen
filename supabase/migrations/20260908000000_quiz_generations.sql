-- ============================================================
-- quiz_generations — LEDGER over genererte quizer («kanonkuler»)
-- + bump_question_usage — kildebump for generatoren
--
-- Kjør i Supabase SQL Editor (service_role). 8. september 2026.
--
-- ── HVORFOR LEDGER OG IKKE TELLER ───────────────────────────────────────────
-- Kvoten (gratis 2, premium 30 per KALENDERMÅNED, ingen overføring) er
-- pengelogikk. En teller på profiles ville vært en cache: den lyver når en
-- generert quiz slettes, og noen må nullstille den ved månedsskiftet — to
-- feilkilder som begge peker mot «for slapp» eller «for streng» uten spor.
-- Kvoten er derfor count(*) over denne tabellen i inneværende kalendermåned
-- (Europe/Oslo — grensen regnes i TS, lib/oslo-time.ts, og sendes inn som
-- ISO-instant). Ingenting nullstilles, ingenting synkes.
--
-- Radene OVERLEVER at quizen slettes (quiz_id ON DELETE SET NULL, ikke
-- CASCADE): en brukt kule er brukt. CASCADE ville gjort «slett quizen» til en
-- måte å få kula tilbake på — akkurat den løgnen telleren ville fortalt.
--
-- `plan` er planen brukeren HADDE i genereringsøyeblikket, frosset. Den
-- brukes ikke til å regne kvote i dag (kvoten leses av gjeldende plan), men
-- er nødvendig for å kunne svare på «hvorfor fikk denne brukeren 30 i
-- august» etter en nedgradering — og for å kunne innføre plan-spesifikk
-- telling senere uten backfill.
--
-- All tilgang via service role (supabaseAdmin). RLS PÅ uten policies — verken
-- anon eller authenticated når tabellen via PostgREST, samme mønster som
-- quiz_notification_log og quiz_notifications.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quiz_generations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- NULL = blandet quiz (ingen kategorivalg). Kategorinavnet er samme streng
  -- som lib/quiz-categories.ts og questions.category — ingen CHECK, av samme
  -- grunn som questions.category ikke har det: lista eies av TS.
  category    text,
  -- Den genererte quizen. SET NULL, ikke CASCADE — se filhodet.
  quiz_id     uuid        REFERENCES public.quizzes(id) ON DELETE SET NULL,
  -- Planen brukeren hadde da kula ble brukt. Frosset øyeblikksbilde.
  plan        text        NOT NULL CHECK (plan IN ('free', 'premium'))
);

COMMENT ON TABLE public.quiz_generations IS
  'Én rad per generert quiz («kanonkule»). Kvoten er count(*) per bruker i '
  'inneværende kalendermåned (Europe/Oslo) — aldri en teller som må '
  'nullstilles. Rader overlever at quizen slettes. Skrives kun av '
  'POST /api/tilfeldig-quiz.';

COMMENT ON COLUMN public.quiz_generations.category IS
  'Valgt kategori (samme streng som questions.category). NULL = blandet.';

COMMENT ON COLUMN public.quiz_generations.quiz_id IS
  'Den genererte quizen (quiz_type=archive, source_quiz_id NULL). ON DELETE '
  'SET NULL med vilje: sletting av quizen gir ikke kula tilbake.';

COMMENT ON COLUMN public.quiz_generations.plan IS
  'free | premium — planen brukeren hadde i genereringsøyeblikket.';

-- Kvotetellingen: WHERE user_id = ? AND created_at >= <månedsstart>.
-- Sammensatt indeks med user_id forrest og created_at som range-hale — én
-- indeks-scan per telling, uansett hvor stor tabellen blir.
CREATE INDEX IF NOT EXISTS quiz_generations_user_created_idx
  ON public.quiz_generations (user_id, created_at);

ALTER TABLE public.quiz_generations ENABLE ROW LEVEL SECURITY;
-- Bevisst ingen policies → kun service role.

-- ============================================================
-- bump_question_usage — øk usage_count/last_used_at på KILDERADENE
--
-- Generatoren skal telle som «bruk» av et bankspørsmål (Dennis, 8. september
-- 2026): «minst brukt / sist brukt» er sorteringen admin styrer etter, og en
-- generert quiz forbruker spørsmålet på samme måte som en admin som legger
-- det i en fredagsquiz. (Arkivruten /api/arkiv bumper fortsatt IKKE — en
-- reprise av quiz 47 er ikke ny bruk. Det er GENERERING som teller, ikke
-- spilling.)
--
-- Én funksjon, ikke N oppdateringer fra TS: PostgREST kan bare sette
-- LITERALE verdier i en UPDATE, så `usage_count = usage_count + 1` er ikke
-- uttrykkbart via .update(). Les-så-skriv fra ruten ville vært 15 rundturer
-- og en tapt-oppdatering-kappløp mellom to samtidige genereringer. Her er det
-- én atomisk UPDATE.
--
-- Fellene fra 25. august er respektert: SET search_path = '' INLINE (CREATE
-- OR REPLACE nullstiller attributter), fullt kvalifiserte navn, og REVOKE
-- som navngir `authenticated` eksplisitt (en revoke fra PUBLIC/anon alene
-- fjerner ikke authenticated sin egen grant — regelen fra 30. juli 2026).
-- ============================================================

CREATE OR REPLACE FUNCTION public.bump_question_usage(p_ids uuid[])
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''   -- MÅ stå inline: CREATE OR REPLACE nullstiller den ellers
AS $$
  WITH bumped AS (
    UPDATE public.questions
       SET usage_count  = usage_count + 1,
           last_used_at = now()
     WHERE id = ANY (p_ids)
    RETURNING id
  )
  SELECT count(*)::integer FROM bumped;
$$;

COMMENT ON FUNCTION public.bump_question_usage(uuid[]) IS
  'Øker usage_count og setter last_used_at=now() på gitte spørsmål. Kalles '
  'kun av POST /api/tilfeldig-quiz etter at kopien er bekreftet. Returnerer '
  'antall rader som ble bumpet.';

REVOKE ALL ON FUNCTION public.bump_question_usage(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_question_usage(uuid[]) TO service_role;

-- ── VERIFISER ETTERPÅ ───────────────────────────────────────────────────────
--   SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'bump_question_usage';
--   -- forventet: prosecdef=true, provolatile='v', proconfig={search_path=},
--   --            proacl uten anon/authenticated.
--
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'quiz_generations';
--   -- forventet: true
