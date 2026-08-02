-- Dekkende indekser for tellerne som leser admin_actions (2. august 2026)
--
-- admin_actions ble opprettet direkte i Supabase og har aldri hatt en
-- migrasjonsfil i repoet. Den hadde derfor kun primærnøkkelen på id — bekreftet
-- med pg_indexes 2. august. Alle tellere som lener seg på tabellen
-- (lib/redeem-throttle.ts, lib/invite-quota.ts, lib/duel-quota.ts, og nå
-- lib/check-email-throttle.ts og lib/org-trial-code-throttle.ts) leste altså
-- uten noe å slå opp i.
--
-- HVORFOR NÅ, når tabellen bare har 12 rader:
-- Det er ikke normal drift som gjør dette til et problem. Bom-tellerne skriver
-- én rad per mislykket forsøk, altså er det ANGRIPEREN som bestemmer hvor fort
-- tabellen vokser — samtidig som bremsen leser fra den ved hver eneste
-- forespørsel. Et gjettingsangrep gjør sin egen brems dyrere for hvert forsøk.
-- Det er den ene vekstkurven man ikke vil ha uindeksert.
--
-- De to formene dekker alle fem tellerne:
--   (action_type, user_id, created_at)  → redeem per konto, duell per avsender
--   (action_type, scope_id, created_at) → redeem per IP, org-invitasjonskvote,
--                                         check-email per IP, org-kode per IP
--
-- scope_type er bevisst utelatt fra den andre: scope_id er en uuid og allerede
-- selektiv nok. Å ta den med ville gjort indeksen bredere uten å gi noe.
--
-- Ingen CONCURRENTLY: tabellen er 32 kB, og Supabase SQL Editor kjører
-- setninger i transaksjon (der CONCURRENTLY ikke er lov).

create index if not exists admin_actions_action_user_created_idx
  on public.admin_actions (action_type, user_id, created_at desc);

create index if not exists admin_actions_action_scope_created_idx
  on public.admin_actions (action_type, scope_id, created_at desc);

analyze public.admin_actions;
