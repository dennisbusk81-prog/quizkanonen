// ── Statusbadgen i admin-listene — FIRE utfall, ikke to ──────────────────────
// (30. august 2026, B-29)
//
// BAKGRUNN
// `getQuizStatus` (lib/quiz-status.ts) svarte allerede riktig med tre utfall.
// Feilen bodde hos KALLEREN: `statusBadge` i app/admin/quizzes/page.tsx spurte
// kun `=== 'åpen'` og lot alt annet falle til «Stengt». To utfall ble dermed
// borte i samme linje:
//
//   • «Fredagsquiz 11.09.2026» er 'kommende' og ble vist som STENGT.
//   • En arkivkopi (opens_at/closes_at begge NULL, lib/archive-copy.ts:197)
//     er 'åpen' etter spillestiens semantikk — og fikk GRØNN «● ÅPEN»-badge,
//     rett ved siden av «Reset» og «Slett», i en liste der arkivkopier og
//     ekte fredagsquizer står blandet.
//
// ── HVORFOR EN NY FUNKSJON OG IKKE EN FJERDE GREN I getQuizStatus ───────────
// `getQuizStatus` sin `(null, null) → 'åpen'` er IKKE new Date(null)-fella —
// den er bevisst paritet med spillestien (lib/quiz-availability.ts): en quiz
// uten tidsvindu ER spillbar, og det er nettopp derfor arkivkopier har NULL.
// lib/quiz-status.test.ts:55 låser den semantikken, og /quizer leser den samme
// funksjonen. Å legge 'arkiv' inn der ville flyttet en VISNINGS-skille inn i
// en funksjon som deler regel med porten som avgjør om noen får spille.
//
// Denne funksjonen er derfor et lag OVER: samme tidsvindu-regel, men med det
// dateløse tilfellet skilt ut som eget utfall før spillbarheten vurderes.
//
// ── NULL SJEKKES EKSPLISITT, FØR noen Date lages ───────────────────────────
// `new Date(null)` er EPOCH 1970, ikke Invalid Date (NONNULL-sveipet
// 26. august 2026). En uguardet leser tolker derfor NULL STILLE som «stengt
// siden 1970» — ingen feilmelding, ingen krasj. Rekkefølgen under er ikke
// kosmetikk: begge NULL-sjekkene står FØR konstruktøren.
//
// Ingen I/O og ingen Date.now() inne i funksjonen — `now` er argument, ellers
// kan utfallene ikke testes.

export type AdminQuizStatus =
  /** Begge datoene mangler — ingen tidsgrense. Arkivkopienes form. */
  | 'arkiv'
  /** `opens_at` ligger i framtiden. */
  | 'kommende'
  /** Har åpnet, har ikke stengt. */
  | 'åpen'
  /** `closes_at` er passert. */
  | 'stengt'

export function adminQuizStatus(
  opensAt: string | null,
  closesAt: string | null,
  now: Date,
): AdminQuizStatus {
  // FØRST, og før enhver `new Date(...)`: en rad uten tidsvindu i det hele
  // tatt er ikke «stengt siden 1970» og ikke «åpen for alltid» — den er
  // utenfor tidsaksen, og skal si det.
  if (!opensAt && !closesAt) return 'arkiv'

  // Resten er tegn for tegn samme predikat som getQuizStatus, med samme
  // grensesemantikk (likhet på grensen regnes som åpnet / fortsatt åpen) og
  // samme NULL-tolkning for ETT manglende felt: opens_at NULL = har åpnet,
  // closes_at NULL = stenger aldri.
  if (opensAt && new Date(opensAt) > now) return 'kommende'
  if (closesAt && new Date(closesAt) < now) return 'stengt'
  return 'åpen'
}
