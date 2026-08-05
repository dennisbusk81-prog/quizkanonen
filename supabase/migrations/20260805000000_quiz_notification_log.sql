-- ============================================================
-- quiz_notification_log — per-mottaker-logg for quiz-varsler
--
-- BAKGRUNN (feilklassen «stemple etter løkken», 5. august 2026)
-- `cron/send-reminders` og `cron/send-push` sendte til en mottakerliste som
-- ble UTLEDET av et filter (`profiles.email_reminders = true`, hele
-- `push_subscriptions`), og stemplet så ÉTT felt på quiz-raden
-- (`reminder_sent_at` / `push_sent_at`) etter at hele løkken var ferdig.
--
-- Et tidsavbrudd midt i løkken gir ingen exception og ingen catch — koden
-- slutter bare å kjøre. Da fantes det ingen tilstand per person å gripe i:
-- enten var quizen merket (og resten fikk ALDRI e-post), eller så var den
-- ikke det (og alle fikk den på nytt). De tre andre cron-jobbene med samme
-- feil (`notify-subscribers`, `re-engagement`, `trial-reminders`) hadde en
-- per-mottaker-kolonne å stemple i; disse to hadde det ikke. Denne tabellen
-- er den manglende tilstanden.
--
-- Rader lever i 30 dager og slettes av `cron/cleanup-notification-log`.
-- Det er en varslingslogg, ikke spilledata: attempts, season_scores og alt
-- annet er urørt og lever videre som før.
--
-- All tilgang skjer via service role (supabaseAdmin). RLS er PÅ uten
-- policies — da har verken anon eller authenticated tilgang via PostgREST,
-- samme mønster som quiz_notifications.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quiz_notification_log (
  quiz_id      uuid        NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  channel      text        NOT NULL,
  scope_id     uuid        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  recipient_id uuid        NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, channel, scope_id, recipient_id)
);

COMMENT ON TABLE public.quiz_notification_log IS
  'Én rad per (quiz, kanal, scope, mottaker) som FAKTISK har fått varselet. '
  'Gjør en avbrutt cron-kjøring gjenopptakbar: neste kjøring henter nøyaktig '
  'restene. Ryddes etter 30 dager av cron/cleanup-notification-log.';

COMMENT ON COLUMN public.quiz_notification_log.channel IS
  'quiz_open_email | quiz_open_push | org_close_email. Se NOTIFY_CHANNEL i '
  'lib/quiz-notification-log.ts — kanalene deler tabell, men aldri rader.';

COMMENT ON COLUMN public.quiz_notification_log.scope_id IS
  'Organisasjonen varselet gjaldt, for org_close_email. Nil-uuid = global '
  '(ingen org). Sentinel i stedet for NULL fordi PostgREST-upsert krever en '
  'unik indeks over vanlige kolonner, og NULL i primærnøkkel er ikke lovlig. '
  'Kolonnen finnes fordi en bruker KAN være medlem i flere organisasjoner '
  '(organization_members er unique på (user_id, organization_id)) og da får '
  'ett varsel per org — uten scope ville de to kollapset til én rad, og vi '
  'ville innført stille undersending i selve tabelldesignet.';

COMMENT ON COLUMN public.quiz_notification_log.recipient_id IS
  'profiles.id for e-postkanalene, push_subscriptions.id for push. Peker på '
  'to ulike tabeller, så ingen fremmednøkkel er mulig. For push er det '
  'ABONNEMENTET og ikke brukeren som er enheten: én bruker kan ha flere '
  'enheter, og feiler bare den ene, skal bare den forsøkes på nytt.';

-- Kun for den daglige ryddingen. Lesningene i cron-rutene filtrerer på
-- quiz_id + channel (+ scope_id) og betjenes av primærnøkkelindeksen, som
-- har nøyaktig de kolonnene forrest.
CREATE INDEX IF NOT EXISTS quiz_notification_log_sent_at_idx
  ON public.quiz_notification_log (sent_at);

ALTER TABLE public.quiz_notification_log ENABLE ROW LEVEL SECURITY;
-- Bevisst ingen policies → kun service role.

-- ── Gamle stempler: døde, ikke droppet ──────────────────────────────────────
-- Filtrene `.is('reminder_sent_at', null)` og `.is('push_sent_at', null)` var
-- selve alt-eller-intet-sjekken. Beholdt sammen med stempling per mottaker
-- ville de byttet dobbeltsending mot STILLE UNDERSENDING: en avbrutt kjøring
-- stempler quizen, quizen forsvinner fra oppslaget, og de gjenstående får
-- aldri varselet — mens ruten rapporterer «ingen quiz å varsle om», som er
-- den normale meldingen 99 % av tiden. Kolonnene leses og skrives ikke lenger.
COMMENT ON COLUMN public.quizzes.reminder_sent_at IS
  'DØD kolonne per 5. august 2026 — erstattet av quiz_notification_log '
  '(channel = quiz_open_email). Skal verken leses eller skrives. Å filtrere '
  'på den igjen gjeninnfører stille undersending.';

COMMENT ON COLUMN public.quizzes.push_sent_at IS
  'DØD kolonne per 5. august 2026 — erstattet av quiz_notification_log '
  '(channel = quiz_open_push). Skal verken leses eller skrives.';

COMMENT ON COLUMN public.organizations.org_close_reminder_quiz_id IS
  'DØD kolonne per 5. august 2026 — erstattet av quiz_notification_log '
  '(channel = org_close_email, scope_id = organisasjonens id). Var et '
  'alt-eller-intet-stempel per org: ble sendingen avbrutt midt i en '
  'organisasjon, fikk resten av medlemmene aldri påminnelsen.';
