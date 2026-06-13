-- Add trial_reminder_sent_at to profiles to prevent duplicate trial-ending emails.
-- Reset to NULL in founders-activate when a new trial starts.
alter table public.profiles
  add column if not exists trial_reminder_sent_at timestamptz;
