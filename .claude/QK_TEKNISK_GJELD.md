# QK — Teknisk gjeld (backlog)

Levende oversikt over teknisk gjeld. Speiles inn i det eksterne
QK_4-lanseringsdokumentet ved behov.

---

## LØST

- **~~season_scores-query i /api/toppliste mangler .limit()~~ — LØST 14. juni 2026.**
  Aggregering + rangering flyttet til Postgres window-funksjoner (ROW_NUMBER)
  via RPC `season_leaderboard_ranked` (migrasjon 20260614000014). Ruten henter
  nå kun den forespurte siden (LIMIT/OFFSET) i stedet for alle rader. Har
  automatisk JS-fallback hvis RPC ikke er deployet. Premium får paginering
  (20/side), navnesøk (ILIKE m/ rang) og "gå til min plassering" i
  `SeasonLeaderboard.tsx`. Gratis-visning (topp-10) uendret.

---

## MEDIUM

- **/toppliste er full klient-side rendering med session-check-waterfall
  før API-kall. Strukturell RSC-migrasjon vurdert, men utsatt pga
  auth/hydration-risiko rett før lansering.**

- **UPDATE-policy på attempts tillater klient-side score-manipulasjon.**
  Policyen "Alle kan oppdatere attempts" (`USING true` / `WITH CHECK true`)
  lar enhver klient — også anon med anon-nøkkelen via devtools — oppdatere
  hvilken som helst attempt-rad. En bruker kan dermed sette egen
  `correct_answers`/`total_time_ms` til hva som helst (juks).
  Krever at finishQuiz sin scoreoppdatering ([app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx))
  flyttes til en service-role server-rute, slik at UPDATE-policyen kan
  fjernes for `public`. Ikke kritisk for liten beta-gruppe, men bør løses
  før B2C-skalering eller før konkurranse-incentiver (premier) introduseres.
