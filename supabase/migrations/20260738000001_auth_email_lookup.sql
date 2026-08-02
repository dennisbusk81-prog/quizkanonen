-- Direkte e-postoppslag for /api/auth/check-email (2. august 2026)
--
-- PROBLEMET
-- Ruten pagineres gjennom HELE auth.users i bolker på 1000 ved hvert kall, for
-- å svare på ett spørsmål: finnes denne e-posten, og hvilke innloggingsmetoder
-- har kontoen. Hver bolk er en HTTP-rundtur til GoTrue som serialiserer alle
-- brukerobjektene, hvorpå ruten filtrerer i JS. Kostnaden vokser med
-- brukertallet, betales ved hvert kall, og ruten er UINNLOGGET — altså kan hvem
-- som helst utløse den. Det er ressursuttømming i tillegg til enumerering.
--
-- LØSNINGEN
-- auth.users.email har allerede unik indeks fra GoTrue. Denne funksjonen gjør
-- oppslaget der det hører hjemme, i én spørring, og returnerer bare det ruten
-- faktisk trenger. Den henter samtidig has_password fra profiles, så det ekstra
-- rundturen dit også forsvinner.
--
-- SECURITY DEFINER fordi auth-skjemaet ikke er eksponert via PostgREST.
-- search_path='' og fullt kvalifiserte navn per herdingen i 20260734000000.
--
-- lower() på begge sider: GoTrue lagrer normalt allerede lowercase, men
-- riktigheten skal ikke AVHENGE av det. På vår størrelse er en seq scan inne i
-- Postgres uansett i mikrosekundklassen — poenget er at vi slutter å sende hele
-- brukertabellen over nettverket.
--
-- match_ids returneres (ikke bare et antall) fordi post-signup-fasen bruker
-- id-ene i serverloggen til å diagnostisere duplikat-kontoer. De går til
-- Vercel-loggen, aldri til klienten — ruten sender fortsatt kun
-- { exists, hasPassword, hasGoogle }.

create or replace function public.auth_email_lookup(p_email text)
returns table (match_ids uuid[], has_google boolean, has_password boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with treff as (
    select u.id, u.raw_app_meta_data, u.created_at
    from auth.users u
    where lower(u.email) = lower(p_email)
  ),
  forste as (
    select t.id, t.raw_app_meta_data
    from treff t
    order by t.created_at asc
    limit 1
  )
  select
    coalesce((select array_agg(t.id order by t.created_at) from treff t), '{}'::uuid[]),
    -- Samme kilde og samme fallback som den gamle JS-koden: identities-arrayet
    -- er tomt i denne Supabase-versjonen, så app_metadata.providers er den
    -- pålitelige kilden, med enkelt-feltet provider som reserve.
    coalesce(
      (select (f.raw_app_meta_data -> 'providers') ? 'google' from forste f),
      (select f.raw_app_meta_data ->> 'provider' = 'google' from forste f),
      false
    ),
    coalesce(
      (select p.has_password from public.profiles p join forste f on f.id = p.id),
      false
    );
$$;

-- REGELEN fra 30. juli: en REVOKE må navngi authenticated EKSPLISITT.
-- Postgres gir authenticated en egen grant som ikke fjernes av «FROM PUBLIC»
-- alene. Denne funksjonen leser auth.users og skal kun kunne kalles av
-- service_role, altså fra serveren.
revoke all on function public.auth_email_lookup(text) from public, anon, authenticated;
grant execute on function public.auth_email_lookup(text) to service_role;

comment on function public.auth_email_lookup(text) is
  'Slår opp én e-post i auth.users. Kun service_role. Erstatter paginering '
  'gjennom hele brukertabellen i /api/auth/check-email.';
