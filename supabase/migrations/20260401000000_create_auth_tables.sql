-- profiles: one row per auth user
create table if not exists public.profiles (
  id           uuid        primary key references auth.users on delete cascade,
  display_name text,
  avatar_color text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.profiles enable row level security;

create policy "profiles_select_all"
  on public.profiles for select
  using (true);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- organizations
create table if not exists public.organizations (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

create policy "organizations_select_all"
  on public.organizations for select
  using (true);

-- organization_members
create table if not exists public.organization_members (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users on delete cascade,
  organization_id uuid        not null references public.organizations on delete cascade,
  role            text        not null default 'member',
  created_at      timestamptz not null default now(),
  unique (user_id, organization_id)
);

alter table public.organization_members enable row level security;

create policy "org_members_select_own"
  on public.organization_members for select
  using (auth.uid() = user_id);
