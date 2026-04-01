-- Add scheduled_at to quizzes for auto-publish cron job.
-- Quizzes where is_active = false and scheduled_at <= now() will be
-- published automatically by the /api/cron/publish-quiz endpoint.

alter table public.quizzes
  add column if not exists scheduled_at timestamptz null;

-- Index to make the cron query fast (only inspects unpublished quizzes with a schedule)
create index if not exists idx_quizzes_scheduled_at
  on public.quizzes (scheduled_at)
  where is_active = false and scheduled_at is not null;
