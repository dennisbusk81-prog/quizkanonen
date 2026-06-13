-- ============================================================
-- quiz_notifications — e-postpåminnelse for uinnloggede besøkende
--
-- Lagrer e-postadresser (PII) til folk som vil varsles når ukens
-- quiz er klar. Skrives kun via service role (supabaseAdmin).
--
-- RLS aktiveres UTEN policies: med RLS på og ingen policy kan verken
-- anon- eller authenticated-klienter lese tabellen via PostgREST —
-- kun service role (som omgår RLS) har tilgang. Dette hindrer
-- e-posthøsting med anon-nøkkelen.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quiz_notifications (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text        NOT NULL,
  created_at       timestamptz DEFAULT now(),
  notified_at      timestamptz,
  notified_quiz_id text,
  UNIQUE (email)
);

ALTER TABLE public.quiz_notifications ENABLE ROW LEVEL SECURITY;

-- Bevisst ingen policies → kun service role har tilgang.
