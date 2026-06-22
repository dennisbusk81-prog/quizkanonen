-- B2B-trial via engangskode (admin-initiert).
-- Dennis genererer en kode i admin-panelet og sender den til en pilot-kunde.
-- Koden aktiverer 14-dagers (eller overstyrt) trial når bedriften registrerer seg.
--
-- Kjøres manuelt i Supabase SQL Editor.

create table if not exists org_trial_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  package         text not null check (package in ('starter', 'standard', 'pro')),
  trial_days      integer not null default 14,
  created_at      timestamptz not null default now(),
  used_at         timestamptz,
  used_by_org_id  uuid references organizations(id) on delete set null,
  created_by_note text
);

-- Rask oppslag på kode ved innløsning/validering
create index if not exists org_trial_codes_code_idx on org_trial_codes (code);

-- RLS: kun service role (supabaseAdmin) kan lese/skrive. Ingen policies =
-- ingen tilgang for anon/authenticated. Service role omgår RLS.
alter table org_trial_codes enable row level security;
