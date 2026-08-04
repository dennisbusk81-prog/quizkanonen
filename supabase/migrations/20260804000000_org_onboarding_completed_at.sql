-- Stempel for «bedriftsadmin har fullført oppsettet på /org/[slug]/velkommen».
--
-- HVORFOR EN EGEN KOLONNE. Vi forsøkte først å utlede dette fra svarene selv,
-- men ingen av dem bærer informasjonen (målt mot prod 4. august 2026):
--
--   allow_global_league  — nullable boolean, men DB-default er `false`. En
--                          fersk org får altså samme verdi som en admin som
--                          bevisst valgte «hold resultatene internt». «Svarte
--                          nei» og «svarte aldri» er ikke til å skille.
--   org_quiz_closes_at   — NULL både når spørsmålet er ubesvart OG når admin
--                          bevisst valgte standardfristen. En redirect på den
--                          ville sendt enhver admin som vil ha vanlig
--                          stengetid til velkomstsiden om og om igjen.
--
-- Stempelet er dessuten en garanti, ikke bare en optimalisering:
-- velkomstsiden nullstiller `org_quiz_opens_at` ved lagring (åpningstiden er
-- felles for alle og kan uansett ikke flyttes tidligere), så et påtvunget
-- gjensyn kunne overskrevet en åpningstid admin senere satte i panelet.
--
-- Nullable, ingen default, ingen backfill: eksisterende orger står som NULL og
-- får oppsettet én gang. Additiv — ingen eksisterende kodesti leser kolonnen
-- før denne migrasjonen er kjørt.
--
-- REKKEFØLGE: denne SQL-en må kjøres FØR koden deployes. admin-data selecter
-- kolonnen eksplisitt, og PostgREST svarer 400 (42703 column does not exist)
-- på hele spørringen hvis den mangler — da faller bedriftspanelet ut for alle.

alter table public.organizations
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.organizations.onboarding_completed_at is
  'Satt når org-admin fullførte /org/[slug]/velkommen. NULL = oppsettet er ikke gjort. Skrives kun av PATCH /api/org/[slug]/settings, og kun når den allerede er NULL.';
