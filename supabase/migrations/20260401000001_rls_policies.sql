-- ============================================================
-- RLS policies for quiz-related tables
-- Run this in Supabase SQL Editor or via supabase db push.
--
-- Convention: no policy = only service role can access.
-- Policies use DROP IF EXISTS so the file is safe to re-run.
-- ============================================================

-- ── quizzes ──────────────────────────────────────────────────
-- Public can SELECT active quizzes. Writes are service-role only.
-- Note: schema uses is_active (not is_published).
alter table public.quizzes enable row level security;

drop policy if exists "quizzes_select_active" on public.quizzes;
create policy "quizzes_select_active"
  on public.quizzes for select
  using (is_active = true);


-- ── questions ────────────────────────────────────────────────
-- Public can SELECT questions that belong to an active quiz.
-- Writes are service-role only.
alter table public.questions enable row level security;

drop policy if exists "questions_select_active_quiz" on public.questions;
create policy "questions_select_active_quiz"
  on public.questions for select
  using (
    exists (
      select 1 from public.quizzes
      where quizzes.id = questions.quiz_id
        and quizzes.is_active = true
    )
  );


-- ── attempts ─────────────────────────────────────────────────
-- Public can SELECT and INSERT. No UPDATE/DELETE.
alter table public.attempts enable row level security;

drop policy if exists "attempts_select_all" on public.attempts;
drop policy if exists "attempts_insert_all" on public.attempts;

create policy "attempts_select_all"
  on public.attempts for select
  using (true);

create policy "attempts_insert_all"
  on public.attempts for insert
  with check (true);


-- ── attempt_answers ──────────────────────────────────────────
-- Public can SELECT and INSERT. No UPDATE/DELETE.
alter table public.attempt_answers enable row level security;

drop policy if exists "attempt_answers_select_all" on public.attempt_answers;
drop policy if exists "attempt_answers_insert_all" on public.attempt_answers;

create policy "attempt_answers_select_all"
  on public.attempt_answers for select
  using (true);

create policy "attempt_answers_insert_all"
  on public.attempt_answers for insert
  with check (true);


-- ── played_log ───────────────────────────────────────────────
-- Public can SELECT and INSERT. No UPDATE/DELETE.
alter table public.played_log enable row level security;

drop policy if exists "played_log_select_all" on public.played_log;
drop policy if exists "played_log_insert_all" on public.played_log;

create policy "played_log_select_all"
  on public.played_log for select
  using (true);

create policy "played_log_insert_all"
  on public.played_log for insert
  with check (true);


-- ── access_codes ─────────────────────────────────────────────
-- No public access. Service role only.
alter table public.access_codes enable row level security;


-- ── admin_users ──────────────────────────────────────────────
-- No public access. Service role only.
alter table public.admin_users enable row level security;


-- ── site_settings ────────────────────────────────────────────
-- Public can SELECT. Writes are service-role only.
alter table public.site_settings enable row level security;

drop policy if exists "site_settings_select_all" on public.site_settings;
create policy "site_settings_select_all"
  on public.site_settings for select
  using (true);


-- ── profiles (already set in 20260401000000, kept here for reference) ──
-- SELECT: all
-- INSERT: auth.uid() = id
-- UPDATE: auth.uid() = id
-- DELETE: none (service role only)
