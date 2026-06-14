-- ============================================================
-- profiles — hindre at en bruker opphever egen suspensjon
--
-- RLS-policyen profiles_update_own (USING auth.uid() = id) lar en bruker
-- oppdatere sin egen profilrad uten kolonnebegrensning. En suspendert
-- bruker kunne derfor sette suspended_until = NULL via et rått klient-kall
-- og oppheve egen suspensjon.
--
-- Denne BEFORE UPDATE-triggeren tilbakestiller suspended_until til OLD-
-- verdien for alle som IKKE er service role. Admin-API-et bruker
-- supabaseAdmin (service role, se app/api/admin/users/[id]/suspend) og
-- får fortsatt endre suspended_until fritt.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_self_unsuspend()
RETURNS TRIGGER AS $$
BEGIN
  -- Tillat service role (admin) å endre suspended_until fritt
  IF current_setting('request.jwt.claims', true)::json->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- For alle andre: behold eksisterende suspended_until
  NEW.suspended_until := OLD.suspended_until;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS prevent_self_unsuspend_trigger ON public.profiles;

CREATE TRIGGER prevent_self_unsuspend_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_unsuspend();
