-- Add email_reminders opt-in flag to profiles.
-- Users with email_reminders = true will receive quiz reminder emails
-- sent by the /api/cron/send-reminders endpoint.

alter table public.profiles
  add column if not exists email_reminders boolean not null default false;
