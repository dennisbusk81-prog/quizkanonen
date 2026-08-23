// ── Nådevinduet ved stengetid — TRE frister, ÉN invariant ────────────────────
// B-10 (24. august 2026): en spiller som var i gang FØR closes_at skal få
// fullføre og levere. Kahoot bryter av kl. 22:00 — vi gjør ikke det. Vinduet
// gjelder KUN forsøk startet før stengetid; nye forsøk etter closes_at er
// fortsatt stengt overalt.
//
// INVARIANTEN: QUESTIONS < SUBMIT <= SCAN. Brytes den, gjenoppstår klippen
// B-10 fjerner, bare på et nytt klokkeslett:
//
//   - QUESTIONS < SUBMIT: den som får siste spørsmål servert i vinduets siste
//     sekund må rekke å LEVERE det — og den som ikke rekker alle spørsmålene
//     må kunne falle tilbake til delvis levering (klientens sikkerhetsnett).
//     Var de like, ville questions servere et spørsmål submit nekter å ta imot.
//   - SUBMIT <= SCAN: publish-quiz-cronen etterjusterer sesongpoeng for
//     innsendinger som lander etter oppgjøret kl. closes_at. En innsending
//     submit AKSEPTERER men skanningen ikke SER, havner på quiz-topplisten
//     uten sesongpoeng — permanent (fella som utløste hele saken).
//
// Lengdene er Dennis' produktvalg 24. august 2026: 5 minutter å spille ferdig
// på gjør at resultatet han deler ~22:06 står seg. En avbrutt spiller trenger
// sjelden mer enn 2–3 min (15 s per spørsmål). Endres tallene, hold invarianten.
// lib/late-play-window.test.ts feller en omordning.

/** Questions-ruten serverer gjenstående spørsmål så lenge til et forsøk startet før closes_at. */
export const QUESTIONS_GRACE_MS = 5 * 60_000

/** Submit tar imot innsendinger så lenge fra et forsøk startet før closes_at. */
export const SUBMIT_GRACE_MS = 7 * 60_000

/** publish-quiz ser etter sene innsendinger å etterjustere for så lenge etter closes_at. */
export const RESETTLE_SCAN_MS = 10 * 60_000

/**
 * Delt kontrakt-tekst for «quizen er stengt» fra spillesti-rutene.
 * Klienten (goToNext i app/quiz/[id]/page.tsx) sammenligner mot denne for å
 * skille «stengetid» fra en transient feil — samme mønster som
 * ALREADY_SUBMITTED_ERROR i lib/submit-response.ts. Ikke skriv teksten ordrett
 * i en rute; da kan de to tolkningene drifte (se admin-sesjon-regelen i
 * CLAUDE.md: klient og server må tolke samme verdi IDENTISK).
 */
export const QUIZ_CLOSED_ERROR = 'Quizen er ikke åpen'

/**
 * Er `now` innenfor et nådevindu etter stengetid? closesAt === null betyr at
 * quizen aldri stenger — da finnes ikke noe vindu (og ingen sperre å myke opp).
 */
export function isWithinGrace(closesAtMs: number | null, nowMs: number, graceMs: number): boolean {
  return closesAtMs !== null && nowMs > closesAtMs && nowMs <= closesAtMs + graceMs
}

/**
 * Startet forsøket før stengetid? `attemptStartedAt` er attempts.completed_at —
 * server-skrevet ved opprettelse (DB-default now(), overskrives aldri; tabellen
 * har ingen created_at-kolonne). Kun slike forsøk får bruke vinduet.
 */
export function attemptStartedBeforeClose(attemptStartedAt: string, closesAtMs: number): boolean {
  return new Date(attemptStartedAt).getTime() <= closesAtMs
}
