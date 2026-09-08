-- ============================================================
-- pool_question_ids + pick_pool_question_ids — puljen og trekningen for en
-- generert quiz («kanonkule»), server-side
--
-- Kjør i Supabase SQL Editor (service_role). 9. september 2026.
--
-- ── HVORFOR ─────────────────────────────────────────────────────────────────
-- POST /api/tilfeldig-quiz hentet hele puljens id-sett (4235 rader: banken
-- + spørsmål i stengte ekte quizer) til Vercel i fem paginerte rundturer,
-- for så å trekke 15 i TS. Målt 8. september 2026 (dev-server mot prod, to
-- genereringer): 1065 og 1218 ms av en total på 2091 og 2315 ms — halvparten
-- av ventetiden fra «Lag quiz» til quizen åpnet. Her trekkes de 15 i én
-- rundtur.
--
-- ── PULJE-REGELEN ER DEN SAMME, OG HVITELISTEN KOMMER INN SOM ARGUMENT ──────
-- Kandidatsettet skal være NØYAKTIG det fetchPoolQuestionIds
-- (lib/generated-quiz-pool.ts) gir — verken flere eller færre:
--   • questions.quiz_id IS NULL                       (biblioteket), ELLER
--   • quiz_id peker på en quiz med quiz_type i HVITELISTEN, is_test = false
--     og closes_at <= p_now                             (stengte ekte quizer)
--   • og, når p_category ikke er NULL: questions.category = p_category
--
-- Hvitelisten (REAL_QUIZ_TYPES i lib/real-quiz-population.ts: weekly, bonus)
-- sendes inn som p_real_types fra TS — den er BEVISST IKKE hardkodet her.
-- CLAUDE.md-fella fra 25. august 2026: migrasjon 20260825000000 hardkodet
-- `quiz_type IN ('weekly', 'bonus')`, og en ny ekte type i TS driftet da
-- stille fra SQL-leserne. Denne funksjonen kan ikke drifte: utvides TS-lista,
-- følger puljen med i samme deploy.
--
-- `is_test = false` (ikke `IS NOT TRUE`): kildegaten i ruten
-- (decideArchiveSourceEligibility) krever === false og avviser NULL som «vet
-- ikke». TS-puljen har nettopp derfor `.eq('is_test', false)` i tillegg til
-- hvitelistens IS NOT TRUE; her er de to sammen bare `= false`.
-- `closes_at <= p_now` utelukker NULL av seg selv, som `.lte()` gjør.
--
-- To funksjoner, ikke én: pool_question_ids er KANDIDATSETTET (verifiserbart
-- mot TS-funksjonen, rad for rad), pick_pool_question_ids er TREKNINGEN
-- (ORDER BY random() LIMIT p_count over det settet). Ruten kaller kun den
-- siste; den første finnes så likheten kan bevises, ikke antas.
--
-- Fellene fra 25. august er respektert: SET search_path = '' INLINE, fullt
-- kvalifiserte navn, og REVOKE som navngir authenticated eksplisitt.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pool_question_ids(
  p_category   text,
  p_real_types text[],
  p_now        timestamptz
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''   -- MÅ stå inline: CREATE OR REPLACE nullstiller den ellers
AS $$
  SELECT q.id
    FROM public.questions q
   WHERE (p_category IS NULL OR q.category = p_category)
     AND (
       q.quiz_id IS NULL
       OR EXISTS (
         SELECT 1
           FROM public.quizzes z
          WHERE z.id = q.quiz_id
            AND z.quiz_type = ANY (p_real_types)
            AND z.is_test = false
            AND z.closes_at <= p_now
       )
     )
   ORDER BY q.id;
$$;

COMMENT ON FUNCTION public.pool_question_ids(text, text[], timestamptz) IS
  'Kandidatsettet for en generert quiz: bank (quiz_id NULL) + spørsmål i '
  'stengte ekte quizer (quiz_type i p_real_types, is_test=false, '
  'closes_at<=p_now), valgfritt avgrenset til én kategori. Speiler '
  'fetchPoolQuestionIds i lib/generated-quiz-pool.ts. Kun service_role.';

CREATE OR REPLACE FUNCTION public.pick_pool_question_ids(
  p_category   text,
  p_count      integer,
  p_real_types text[],
  p_now        timestamptz
)
RETURNS uuid[]
LANGUAGE sql
VOLATILE   -- random()
SECURITY DEFINER
SET search_path = ''   -- MÅ stå inline: CREATE OR REPLACE nullstiller den ellers
AS $$
  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    FROM (
      SELECT id
        FROM public.pool_question_ids(p_category, p_real_types, p_now) AS id
       ORDER BY random()
       LIMIT GREATEST(p_count, 0)
    ) s;
$$;

COMMENT ON FUNCTION public.pick_pool_question_ids(text, integer, text[], timestamptz) IS
  'Trekker p_count tilfeldige, distinkte spørsmåls-id-er fra pool_question_ids. '
  'Færre enn p_count tilbake betyr at puljen er mindre enn p_count. '
  'Kalles kun av POST /api/tilfeldig-quiz.';

REVOKE ALL ON FUNCTION public.pool_question_ids(text, text[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pool_question_ids(text, text[], timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.pick_pool_question_ids(text, integer, text[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_pool_question_ids(text, integer, text[], timestamptz) TO service_role;

-- ── VERIFISER ETTERPÅ ───────────────────────────────────────────────────────
--   SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname IN ('pool_question_ids', 'pick_pool_question_ids');
--   -- forventet: prosecdef=true, proconfig={search_path=}, proacl uten anon/authenticated;
--   --            provolatile 's' for pool_question_ids, 'v' for pick_pool_question_ids.
--
--   SELECT count(*) FROM public.pool_question_ids(NULL, ARRAY['weekly','bonus'], now());
--   -- forventet: 4235 per 8. september 2026 (4040 bank + 195 i stengte ekte quizer)
--
--   SELECT array_length(public.pick_pool_question_ids('Sport', 15, ARRAY['weekly','bonus'], now()), 1);
--   -- forventet: 15
