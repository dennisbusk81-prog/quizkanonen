-- ============================================================
-- questions — skjul fasiten (correct_answer/correct_answers) fra klienten
--
-- BAKGRUNN (#2):
-- Policyen "questions_select_active_quiz" ga offentlig SELECT på ALLE kolonner
-- på questions, inkl. correct_answer/correct_answers. Klienten gjorde select('*')
-- og fikk hele fasiten i nettverksfanen før spilleren svarte.
--
-- ETTER DENNE MIGRASJONEN:
--   • Direkte anon/authenticated SELECT på questions-tabellen fjernes (RLS uten
--     SELECT-policy = ingen rader). Fasiten kan ikke lenger leses av klienten.
--   • Spill leveres ett spørsmål av gangen via /api/quiz/[id]/questions
--     (supabaseAdmin, service_role) — hvert spørsmål bærer kun sin egen fasit.
--   • questions_public-view (uten fasit) eksponeres for anon/authenticated for
--     ev. fremtidige offentlige lesebehov.
--   • Skriv + admin går via service_role og er upåvirket.
--
-- NB: questions_public kjører med eierens (postgres) rettigheter (ikke
-- security_invoker), slik at anon kan lese den selv om direkte tabell-SELECT er
-- fjernet. WHERE-klausulen bevarer «kun aktive quizer»-begrensningen.
--
-- ⚠️ KJØR MANUELT I SUPABASE SQL EDITOR FØRST ETTER at koden er deployet og
--    quiz-spilling er verifisert i prod (klienten henter nå spørsmål via
--    server-ruten, ikke direkte fra questions-tabellen).
--
-- Idempotent.
-- ============================================================

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

-- Fjern offentlig SELECT direkte på tabellen (skjuler fasit-kolonnene).
DROP POLICY IF EXISTS "questions_select_active_quiz" ON public.questions;

-- Offentlig, fasit-fri view (kun aktive quizer — speiler tidligere policy).
DROP VIEW IF EXISTS public.questions_public;
CREATE VIEW public.questions_public AS
  SELECT q.id, q.quiz_id, q.question_text,
         q.option_a, q.option_b, q.option_c, q.option_d,
         q.time_limit_seconds, q.order_index, q.explanation,
         q.category, q.shuffle_options, q.is_classic
  FROM public.questions q
  WHERE EXISTS (
    SELECT 1 FROM public.quizzes z
    WHERE z.id = q.quiz_id AND z.is_active = true
  );

GRANT SELECT ON public.questions_public TO anon, authenticated;
