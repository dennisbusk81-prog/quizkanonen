# QK — Teknisk gjeld (backlog)

Levende oversikt over teknisk gjeld. Speiles inn i det eksterne
QK_4-lanseringsdokumentet ved behov.

---

## MEDIUM

- **season_scores-query i /api/toppliste mangler .limit() — henter potensielt
  20 000+ rader for alltime-visning ved skalering. Trenger
  paginering/aggregeringsstrategi.**

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
