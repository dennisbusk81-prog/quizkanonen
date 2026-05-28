-- Add re_engagement_sent_at to profiles.
-- Tracks when a re-engagement email was sent so we never send more than once per user.
-- NULL means no re-engagement email has been sent yet.
--
-- Run in Supabase SQL editor:
--   ALTER TABLE profiles ADD COLUMN re_engagement_sent_at timestamptz;

alter table public.profiles
  add column if not exists re_engagement_sent_at timestamptz;
