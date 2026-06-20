-- Individuelt fravalg av global sesong-toppliste per org-medlemskap.
--
-- NULL  = ikke besvart (følger org sin allow_global_league-policy)
-- true  = brukeren har aktivt valgt seg UT av global synlighet
-- false = brukeren har aktivt valgt seg INN (men org-policyen er fortsatt taket:
--         allow_global_league=false på org blokkerer uansett)
--
-- Idempotent: trygt å kjøre flere ganger. Ingen eksisterende rader endres —
-- default NULL betyr "uendret oppførsel" for alle nåværende medlemmer.

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS global_league_opt_out boolean DEFAULT NULL;
