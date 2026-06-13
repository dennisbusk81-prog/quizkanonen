-- ============================================================
-- push_subscriptions — Web Push (PWA) abonnementer per bruker
--
-- Dokumenterer skjemaet som ble kjørt manuelt under PWA-økten.
-- Idempotent: trygg å kjøre på en database som allerede har tabellen.
--
-- All app-tilgang skjer via service role (supabaseAdmin). RLS-policyen
-- sikrer at en eventuell direkte klient-spørring kun ser/endrer egne rader.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint   text        NOT NULL,
  p256dh     text        NOT NULL,
  auth       text        NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Bruker kan administrere egne push-subscriptions" ON public.push_subscriptions;

CREATE POLICY "Bruker kan administrere egne push-subscriptions"
  ON public.push_subscriptions FOR ALL
  USING (user_id = auth.uid());
