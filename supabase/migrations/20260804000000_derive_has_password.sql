-- ============================================================
-- has_password avledes fra auth.users i stedet for å settes (4. august 2026)
--
-- BAKGRUNN
-- profiles.has_password var en PÅSTAND. Den ble satt av
-- /api/auth/mark-password, som tok `userId` rått fra request-body og ikke hadde
-- én eneste auth-sjekk — ingen sesjon, intet token, ingen signatur. Hvem som
-- helst kunne sette has_password=true på en vilkårlig bruker-id, og fordi
-- profiles har en åpen SELECT-policy var det trivielt å skaffe id-ene.
--
-- Ingen kontoovertakelse — feltet gater ingenting — men det brøt selvbetjent
-- gjenoppretting: en Google-bruker fikk «feil passord» i stedet for «denne
-- kontoen har ikke passord ennå», og mistet knappen som sender lenken.
--
-- Fiksen er ikke å beskytte påstanden, men å fjerne den. Sannheten om hvorvidt
-- en konto har passord ligger allerede i auth.users.encrypted_password. Etter
-- denne migrasjonen leses den der, og det finnes ingen skrivbar inngang igjen.
--
-- ⚠️ REKKEFØLGE: KJØR DENNE FØR KODEN DEPLOYES.
--    Motsatt av 20260616190001 (som måtte kjøres etter). Koden i denne
--    endringen kaller auth_has_password(), og /api/auth/mark-password er
--    slettet. Deployer du koden først, feiler passord-seksjonen på /profil og
--    «Passord»-merket i admin fram til funksjonen finnes.
--
-- Idempotent: create or replace + revoke/grant kan kjøres flere ganger.
-- ============================================================


-- ── STEG 1 — MÅL FØRST, IKKE ANTA ───────────────────────────────────────────
--
-- Kjør denne FØR resten av filen. Den avgjør om predikatet under er riktig.
-- Ren lesing, returnerer kun aggregater — ingen passord-hasher hentes ut.
--
--   select
--     case
--       when u.encrypted_password is null then 'NULL'
--       when u.encrypted_password = ''    then 'TOM STRENG'
--       else 'IKKE-TOM (' || length(u.encrypted_password) || ' tegn)'
--     end                                                  as passord_kolonne,
--     coalesce(u.raw_app_meta_data ->> 'provider', 'ukjent') as provider,
--     (u.confirmed_at is null)                             as ubekreftet,
--     count(*)                                             as antall
--   from auth.users u
--   group by 1, 2, 3
--   order by 2, 1;
--
-- FORVENTET (kolonnen): rader med provider='google' skal vise NULL eller TOM
-- STRENG. Predikatet under (`is not null and <> ''`) dekker begge utfallene, så
-- forskjellen NULL/'' krever ingen endring.
--
-- 🚩 STOPP hvis en google-rad viser IKKE-TOM. Da lagrer denne GoTrue-versjonen
--    en ubrukelig plassholder-hash for OAuth-brukere, predikatet blir sant for
--    alle Google-brukere, og resultatet er verre enn dagens bug. Si fra —
--    da må vi i stedet kombinere med raw_app_meta_data->'providers' ? 'email'.
--
-- FORVENTET (ubekreftet): finnes det rader med ubekreftet=true OG
-- passord_kolonne=IKKE-TOM, er signup-stien bevist dekket — GoTrue skriver
-- passordet ved registrering, altså FØR e-postbekreftelsen, og avledningen
-- svarer riktig i hele vinduet der den gamle koden trengte en uautentisert
-- markeringsrute. Er det ingen ubekreftede kontoer akkurat nå, er spørsmålet
-- ubesvart av datasettet, ikke besvart med nei — se STEG 5-notatet nederst.


-- ── STEG 2 — Avledet oppslag for én bruker ──────────────────────────────────
--
-- SECURITY DEFINER fordi auth-skjemaet ikke er eksponert via PostgREST — samme
-- mønster og samme begrunnelse som public.auth_email_lookup.
--
-- search_path = '' og fullt kvalifiserte navn per herdingen i 20260734000000.
--
-- Predikatet er bevisst `is not null AND <> ''`: begge er «ingen passord», og
-- vi vil ikke at riktigheten skal avhenge av hvilken av de to representasjonene
-- GoTrue-versjonen tilfeldigvis bruker.
create or replace function public.auth_has_password(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select u.encrypted_password is not null and u.encrypted_password <> ''
      from auth.users u
      where u.id = p_user_id
    ),
    false
  );
$$;

-- REGELEN fra 30. juli: en REVOKE må navngi authenticated EKSPLISITT. Postgres
-- gir authenticated en egen grant som ikke fjernes av «FROM PUBLIC» alene.
-- Denne funksjonen leser auth.users og skal kun kunne kalles fra serveren.
revoke all on function public.auth_has_password(uuid) from public, anon, authenticated;
grant execute on function public.auth_has_password(uuid) to service_role;

comment on function public.auth_has_password(uuid) is
  'Avgjør om en konto har passord, lest fra auth.users.encrypted_password. '
  'Kun service_role. Erstatter det skrivbare feltet profiles.has_password.';


-- ── STEG 3 — auth_email_lookup leser samme sannhet ──────────────────────────
--
-- Den tredje leseren, og den som faktisk bar konsekvensen av bugen: det er
-- denne som forteller /login om en konto har passord, og dermed om brukeren
-- får «feil passord» eller «denne kontoen har ikke passord ennå».
--
-- ENESTE endring fra 20260738000001: has_password hentes fra
-- auth.users.encrypted_password i stedet for public.profiles. Signatur,
-- returtype, match_ids og has_google er uendret.
create or replace function public.auth_email_lookup(p_email text)
returns table (match_ids uuid[], has_google boolean, has_password boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with treff as (
    select u.id, u.raw_app_meta_data, u.encrypted_password, u.created_at
    from auth.users u
    where lower(u.email) = lower(p_email)
  ),
  forste as (
    select t.id, t.raw_app_meta_data, t.encrypted_password
    from treff t
    order by t.created_at asc
    limit 1
  )
  select
    coalesce((select array_agg(t.id order by t.created_at) from treff t), '{}'::uuid[]),
    -- Uendret: identities-arrayet er tomt i denne Supabase-versjonen, så
    -- app_metadata.providers er den pålitelige kilden, med provider som reserve.
    coalesce(
      (select (f.raw_app_meta_data -> 'providers') ? 'google' from forste f),
      (select f.raw_app_meta_data ->> 'provider' = 'google' from forste f),
      false
    ),
    -- ENDRET: var «select p.has_password from public.profiles p join forste ...»
    coalesce(
      (select f.encrypted_password is not null and f.encrypted_password <> '' from forste f),
      false
    );
$$;

-- create or replace beholder eksisterende ACL, men vi gjentar dem så filen er
-- selvstendig korrekt om funksjonen en gang skulle bli droppet og gjenskapt.
revoke all on function public.auth_email_lookup(text) from public, anon, authenticated;
grant execute on function public.auth_email_lookup(text) to service_role;


-- ── STEG 4 — Rydd bort den døde kolonnen (KJØR SEPARAT, ETTERPÅ) ────────────
--
-- IKKE kjør denne sammen med resten. Kjør den først når koden er deployet og
-- verifisert, slik at en rollback av koden fortsatt har en kolonne å lese.
--
-- Hvorfor den bør bort til slutt, og ikke bare bli liggende: profiles er
-- offentlig lesbar (profiles_select_all). En kolonne ingen lenger skriver til
-- er ikke bare død vekt — den er feilinformasjon som hvem som helst kan lese,
-- og neste utvikler som finner den vil tro den betyr noe.
--
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS has_password;
--
-- 20260718000000_profiles_has_password.sql beskriver kolonnen som den var, og
-- beholdes som historikk.


-- ── STEG 5 — Hvorfor signup-stien ikke trenger noe eget ─────────────────────
--
-- Den gamle løsningens svakeste punkt: ved passord-signup finnes det ingen
-- sesjon (Confirm email er PÅ → signUp gir ingen), og heller ingen profilrad.
-- Markeringen MÅTTE derfor være uautentisert for å virke i det hele tatt. Det
-- var ikke en glipp i implementasjonen — det var en konsekvens av å lagre
-- påstanden et sted brukeren ennå ikke hadde tilgang til.
--
-- Avledningen har ikke det problemet, fordi den ikke skriver noe: passordet er
-- allerede i auth.users.encrypted_password fra det øyeblikket signUp returnerer.
-- To uavhengige holdepunkter for at raden finnes og er utfylt før bekreftelsen:
--   1) Den gamle koden i AuthForm leste `data.user.id` rett etter signUp og
--      brukte den som fremmednøkkel mot auth.users — raden fantes altså.
--   2) Bekreftelseslenken bærer kun et token_hash, ikke passordet. Hadde ikke
--      hashen vært lagret ved registrering, ville den vært umulig å gjenskape.
-- Punkt 3 er måletallet i STEG 1: ubekreftet=true + IKKE-TOM passord_kolonne.
--
-- Praktisk konsekvens: en bruker som registrerer seg med passord og aldri
-- bekrefter e-posten, får nå riktig svar fra /login («feil passord», ikke
-- «denne kontoen har ikke passord»). Det er en liten forbedring over gammel
-- oppførsel, der markeringen kunne feile stille og etterlate feltet false.
