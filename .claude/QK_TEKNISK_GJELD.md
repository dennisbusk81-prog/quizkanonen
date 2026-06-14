# QK — Teknisk gjeld (backlog)

Levende oversikt over teknisk gjeld. Speiles inn i det eksterne
QK_4-lanseringsdokumentet ved behov.

---

## MEDIUM

- **UPDATE-policy på attempts tillater klient-side score-manipulasjon.**
  Policyen "Alle kan oppdatere attempts" (`USING true` / `WITH CHECK true`)
  lar enhver klient — også anon med anon-nøkkelen via devtools — oppdatere
  hvilken som helst attempt-rad. En bruker kan dermed sette egen
  `correct_answers`/`total_time_ms` til hva som helst (juks).
  Krever at finishQuiz sin scoreoppdatering ([app/quiz/[id]/page.tsx](../app/quiz/%5Bid%5D/page.tsx))
  flyttes til en service-role server-rute, slik at UPDATE-policyen kan
  fjernes for `public`. Ikke kritisk for liten beta-gruppe, men bør løses
  før B2C-skalering eller før konkurranse-incentiver (premier) introduseres.
