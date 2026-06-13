-- ============================================================
-- organization_invites — invitasjonslenker til bedrifter (B2B)
--
-- Tabellen ble opprettet manuelt uten migrasjon. Denne filen
-- dokumenterer skjemaet + RLS slik det allerede er i produksjon.
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
--
-- All app-tilgang skjer via service role (supabaseAdmin), som omgår
-- RLS. Policyene gir org-admin direkte tilgang for det tilfellet at
-- en authenticated klient leser/skriver direkte via PostgREST.
-- Admin = rad i organization_members med role='admin' for samme org.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token           text        NOT NULL UNIQUE,
  created_by      uuid        REFERENCES auth.users ON DELETE SET NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  expires_at      timestamptz,
  max_uses        integer,
  use_count       integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

-- Hjelpeuttrykk gjenbrukes i alle policyene: er innlogget bruker admin
-- for invitasjonens organisasjon?
DROP POLICY IF EXISTS "org_invites_select_admin" ON public.organization_invites;
DROP POLICY IF EXISTS "org_invites_insert_admin" ON public.organization_invites;
DROP POLICY IF EXISTS "org_invites_update_admin" ON public.organization_invites;
DROP POLICY IF EXISTS "org_invites_delete_admin" ON public.organization_invites;

-- SELECT: org-admin kan lese invitasjoner for egen organisasjon
CREATE POLICY "org_invites_select_admin"
  ON public.organization_invites FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM   public.organization_members
      WHERE  user_id = auth.uid()
        AND  role = 'admin'
    )
  );

-- INSERT: org-admin kan opprette invitasjoner for egen organisasjon
CREATE POLICY "org_invites_insert_admin"
  ON public.organization_invites FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM   public.organization_members
      WHERE  user_id = auth.uid()
        AND  role = 'admin'
    )
  );

-- UPDATE: org-admin kan endre (f.eks. deaktivere) egne invitasjoner
CREATE POLICY "org_invites_update_admin"
  ON public.organization_invites FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM   public.organization_members
      WHERE  user_id = auth.uid()
        AND  role = 'admin'
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM   public.organization_members
      WHERE  user_id = auth.uid()
        AND  role = 'admin'
    )
  );

-- DELETE: org-admin kan slette egne invitasjoner
CREATE POLICY "org_invites_delete_admin"
  ON public.organization_invites FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM   public.organization_members
      WHERE  user_id = auth.uid()
        AND  role = 'admin'
    )
  );
