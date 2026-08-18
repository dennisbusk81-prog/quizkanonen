# QK — Oppdatering: RPC-gating-hull lukket (30. juli 2026, kveld)

Sikkerhetsøkt. Ingen kodeendring — kun SQL kjørt manuelt av Dennis i Supabase
SQL Editor, alle tre blokker verifisert. Dette dokumentet er en kopierbar
oppdatering til de eksterne dokumentene QK_1, QK_3 og QK_4 (ligger utenfor
dette repoet, så Claude Code kan ikke redigere dem direkte).

---

## OPPDATER QK_1 (Sikkerhet-seksjonen)

Flytt fra "gjenstående WARN" til FIKSET:

> **RPC-funksjoner kallbare direkte av `authenticated`, forbi API-rutenes
> Premium-gating — FIKSET 30. juli 2026.**
> 11 SECURITY DEFINER-funksjoner (`season_leaderboard_ranked/user_stats/
> period_quizzes`, `quiz_leaderboard_ranked/user_stats/better_count`,
> `attempt_answer_option_counts`, `attempt_answer_stats_by_attempts`,
> `weekly_active_players`, `count_active_players_since`,
> `count_active_leagues`) hadde kun `REVOKE EXECUTE FROM PUBLIC, anon` —
> ikke `authenticated`.
>
> **Rotårsak:** Postgres gir `authenticated` en egen, eksplisitt
> EXECUTE-grant ved funksjonsoppretting, som IKKE fjernes av en revoke fra
> PUBLIC alene. `REVOKE ... FROM PUBLIC, anon` var derfor virkningsløst mot
> nettopp den rollen enhver innlogget bruker har.
>
> **Empirisk bekreftet mot prod** (fixture-gratisbruker, eget JWT + anon-
> nøkkel, direkte mot `/rest/v1/rpc/<funksjon>`, utenom alle API-ruter):
> alle 11 svarte 200 med reelle data — inkludert andre brukeres eksakte
> `rank`/`points`, full svarfordeling per spørsmål, og admin-dashboardtall.
> Anon (ikke innlogget) var korrekt blokkert på alle 11.
>
> **Fiks:** eksplisitt `REVOKE EXECUTE ... FROM authenticated, anon, PUBLIC`
> på alle 11. Verifisert i `pg_proc.proacl` — kun `postgres`/`service_role`
> gjenstår.
>
> **`is_league_member` ble BEVISST IKKE revokert.** Den kalles fra
> RLS-policyen på `league_members` selv (se fix for 42P17-rekursjonen,
> 23. juli) og evaluerer `auth.uid()` — altså kun om KALLEREN selv er
> medlem. Den lekker ingenting uansett hvem som kaller den, og å revokere
> den ville brutt RLS-policyen for anon/authenticated på `leagues` og
> `season_scores`.
>
> **`redeem_access_code` fikk samtidig `SET search_path=''`** (manglet
> fra før, i motsetning til det etablerte mønsteret) + fullt kvalifiserte
> `public.`-navn i kroppen (kroppen brukte ukvalifiserte navn — en blind
> `SET search_path=''` uten kvalifisering ville knekt funksjonen).
> Funksjonelt reverifisert av Dennis mot ekte kodeinnløsning i prod.
>
> **Ny regel for alle framtidige SECURITY DEFINER-funksjoner ment kun for
> service_role:** REVOKE må navngi `authenticated` eksplisitt.
> `FROM PUBLIC, anon` er IKKE nok.

---

## OPPDATER QK_3 (paywall-seksjonen)

Fjern "ÅPENT SPØRSMÅL SOM MÅ VERIFISERES" om Premium-gating på
sesong-/quiz-toppliste og svarfordeling. Er nå verifisert og lukket —
se punktet over. Erstatt med en kort setning: "Verifisert 30. juli 2026:
gating håndheves nå også på RPC-nivå, ikke bare i API-rutene."

---

## OPPDATER QK_4 (prioritert rekkefølge, punkt 1)

Merk punkt 1 som FERDIG, flytt ut av aktiv prioritert liste. Behold denne
logglinjen til referanse:

> ~~1. RPC-gating-hull: 11 Premium-gatede funksjoner kallbare av enhver
> innlogget gratisbruker~~ — FIKSET 30. juli 2026. Empirisk bekreftet
> (fixture-testbruker, egen JWT), deretter lukket med eksplisitt
> `REVOKE ... FROM authenticated`. Se QK_1 for full teknisk detalj.

---

## NYTT FUNN UTENFOR BESTILLINGEN — egen sårbarhetsklasse

Dette hører IKKE hjemme inni RPC-punktet over — det er en helt annen
feilklasse (åpen RLS-policy på en tabell, ikke manglende EXECUTE-revoke
på en funksjon). Dokumenter som eget punkt i QK_1/teknisk gjeld:

> **`access_codes`-tabellen var offentlig lesbar uten innlogging — FIKSET
> 30. juli 2026.** Oppdaget ved samme gjennomgang, ikke del av selve
> RPC-bestillingen. En helt åpen SELECT-policy ga ren anon-nøkkel (ingen
> Authorization-header i det hele tatt) lesetilgang til samtlige koder i
> klartekst: kodeord, `max_uses`, `used_count`, `is_active`, `valid_until`.
> Dette opphever hele entropi-modellen fra 26. juli for `personal`-koder
> (~59,5 bits blir verdiløst når koden kan leses rett ut av databasen).
> **Ingen skade i dag** — kun 2 koder eksisterer i prod, begge `shared`,
> én inaktiv (FREDAG2025) og én oppbrukt 1/1 (TESTKODE1) — men ville
> smelt den dagen en `personal`-premiekode opprettes. Policyen droppet,
> RLS slått på. Appens eneste tilgang til tabellen er via `service_role`
> (`/api/codes/redeem`, admin-ruter), upåvirket.

---

## Endrede/kjørte denne økten
- Ingen filer i repoet (før dette dokumentet + speilet inn i
  `.claude/QK_TEKNISK_GJELD.md` og `.claude/CLAUDE.md`)
- 3 SQL-blokker kjørt manuelt av Dennis i Supabase SQL Editor, alle
  verifisert (se detaljer over)
