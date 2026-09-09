-- ============================================================
-- profiles — avmeldingskolonner for de to siste repeterende e-postene
--
-- weeklyReportEmail (cron/weekly-report → org-admins) og
-- orgCloseReminderEmail (cron/send-reminders → org-medlemmer) var de to
-- eneste repeterende utsendingene UTEN en fungerende avmeldingsvei: de
-- pekte kun på /profil i teksten, og det fantes ingen HMAC-type for dem
-- (se lib/unsubscribe.ts). Derfor sto de også utenfor List-Unsubscribe-
-- runden i 3fe0e58 — en header som peker på noe som ikke virker er verre
-- enn ingen header.
--
-- NOT NULL DEFAULT true, ikke nullable DEFAULT true som
-- email_reengagement/email_duel_notifications fra 20260614000004:
-- utsendingsstedene filtrerer med `.eq(<kolonne>, true)`, og PostgREST-
-- filtre matcher ALDRI NULL. En nullable kolonne ville gitt et stille hull
-- der en rad med NULL falt ut av utsendingen uten at noen hadde meldt seg
-- av. NOT NULL fjerner den tredje tilstanden helt.
--
-- DEFAULT true = opt-out, ikke opt-in: begge e-postene går ut i dag, og en
-- migrasjon skal ikke stanse en utsending folk allerede får.
-- ADD COLUMN med DEFAULT backfyller eksisterende rader (PG 11+), så ingen
-- eksisterende mottaker mister e-posten.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_weekly_report boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_org_reminders boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.email_weekly_report IS
  'Ukesrapporten til org-admins (cron/weekly-report). false = avmeldt, via unsubscribe-type "weeklyreport".';

COMMENT ON COLUMN public.profiles.email_org_reminders IS
  'Bedriftens «en time igjen»-påminnelse (cron/send-reminders, org-grenen). false = avmeldt, via unsubscribe-type "orgclose".';
