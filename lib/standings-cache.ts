// ── Cache-strategi for /api/quiz/[id]/standings ──────────────────────────────
// Ren logikk (ingen I/O) etter samme mønster som decideAnswerKeyPatch og
// decidePremiumState: ruten gjør oppslagene, denne filen tar beslutningen, og
// beslutningen er testbar uten database.
//
// To akser avgjør headeren:
//
//   1. ÅPEN vs. STENGT quiz. En åpen quiz sin toppliste endrer seg for hver
//      innsending. En stengt quiz sin er i praksis endelig.
//   2. DELT vs. PERSONLIG svar. Uten spiller-parametere er svaret identisk for
//      alle (kun topp-3) og kan deles i en CDN. Med attemptId/correct/time er
//      `placement` spillerens egen og hører ikke hjemme i en delt cache.
//
// ── HVORFOR IKKE `immutable`, OG HVORFOR IKKE revalidateTag ──────────────────
// Det er fristende å behandle en stengt quiz som permanent og sette en lang
// `immutable`-header. Det ville vært feil, av tre grunner som alle er verifisert
// i denne kodebasen:
//
//   a) `submit` håndhever IKKE closes_at. En spiller som startet før stengetid
//      kan levere etter — quiz-siden har en egen melding for nettopp det
//      ("Quizen stengte mens du spilte"). Topplista kan altså endre seg noen
//      minutter ETTER closes_at.
//   b) `PATCH /api/admin/quizzes/[id]` gjør `update(body)` rått, uten vern mot
//      å flytte closes_at. En admin kan dermed åpne en stengt quiz igjen.
//   c) En fasit-korreksjon via /api/admin/correct-answer regraderer svarene og
//      endrer rangeringen.
//
// For (c) ber oppdraget om «samme tag-mønster» som correct-answer-ruten bruker.
// Det lar seg ikke gjøre: `revalidateTag` invaliderer Next.js sin egen
// Data Cache (unstable_cache / tagged fetch) — den rører ikke `Cache-Control`.
// Et svar som allerede ligger i en nettleser eller i CDN-en fordi VI sendte
// `s-maxage`, kan ikke nås av revalidateTag. Kallet i correct-answer gjelder
// forsidens unstable_cache('home-shared-data'), som er en annen cache-type.
//
// Konsekvensen styrer designet: siden vi ikke KAN purge, må vi i stedet gjøre
// vinduet kort nok til at alle tre tilfellene over leger seg selv. Derfor en
// moderat s-maxage og ingen `immutable` — utdatert data forsvinner av seg selv
// innen SHARED_CLOSED_S_MAXAGE sekunder, uten noen purge-infrastruktur.
//
// `max-age=0` på de delte variantene er med vilje: kun CDN-en (s-maxage) skal
// holde på svaret. En nettleser-cache er vi helt uten kontroll over, og
// gevinsten vi er ute etter — å slippe en kald funksjonsstart — hentes uansett
// i CDN-laget.

/** Delt, stengt quiz: hvor lenge CDN-en får gjenbruke svaret. */
export const SHARED_CLOSED_S_MAXAGE = 120

/**
 * Delt, åpen quiz: speiler CACHE_TTL_MS (10s) i lib/ranking-snapshot.ts med
 * vilje — samme størrelsesorden som utdatertheten datagrunnlaget allerede har.
 *
 * Vær presis om hva det betyr: verste fall er ikke 10 sekunder, men opptil 20 —
 * en snapshot som allerede er 10s gammel når CDN-en lagrer den, kan serveres i
 * 10 sekunder til. Det er akseptert her fordi svaret kun brukes til topp-3 på
 * en åpen quiz (en personlig plassering er aldri delt, se tabellen under), og
 * fordi målingene viser maks 3–4 samtidige spillere — topp-3 skifter sjelden
 * innenfor et 20-sekundersvindu.
 */
export const SHARED_OPEN_S_MAXAGE = 10

/** Personlig svar på stengt quiz: kun spillerens egen nettleser, kort. */
export const PRIVATE_CLOSED_MAX_AGE = 60

export type StandingsCacheInput = {
  /** quizzes.closes_at. null = quizen stenger aldri, altså alltid åpen. */
  closesAt: string | null
  /**
   * Ble svaret formet av spiller-spesifikke parametere (attemptId, correct
   * eller time)? Da inneholder `placement` denne spillerens egen plassering.
   */
  personalized: boolean
  /** Millisekunder siden epoch. Injisert slik at tester slipper klokke-flakhet. */
  now: number
}

/**
 * Er quizen stengt på tidspunktet `now`?
 *
 * Fail-safe: manglende eller uparsebar closes_at regnes som ÅPEN. En åpen quiz
 * får den korteste cachen, så en dato vi ikke forstår gir minst mulig
 * utdaterthet i stedet for mest mulig.
 *
 * Merk at det holder å se på quizzes.closes_at globalt, selv om organisasjoner
 * kan ha egne tider: /api/org/my-quiz-times klamper hver org sitt vindu med
 * `min(orgCloses, globalCloses)`, så en org kan kun stenge TIDLIGERE enn den
 * globale fristen, aldri senere. Har den globale fristen passert, er quizen
 * stengt for absolutt alle — og «stengt» er dermed en egenskap ved quizen, ikke
 * ved den som spør. Det er nettopp det som gjør et DELT cache-svar forsvarlig.
 */
export function isQuizClosed(closesAt: string | null, now: number): boolean {
  if (!closesAt) return false
  const ms = new Date(closesAt).getTime()
  if (!Number.isFinite(ms)) return false
  return now > ms
}

/**
 * Cache-Control-verdien for et standings-svar.
 *
 *  | quiz   | svar      | header                              |
 *  |--------|-----------|-------------------------------------|
 *  | åpen   | delt      | public, s-maxage=10, max-age=0      |
 *  | åpen   | personlig | private, no-store                   |
 *  | stengt | delt      | public, s-maxage=120, max-age=0     |
 *  | stengt | personlig | private, max-age=60                 |
 *
 * Et personlig svar blir ALDRI `public`. Parameterne ligger riktignok i
 * query-strengen og dermed i cache-nøkkelen, så en delt cache ville ikke lekket
 * mellom spillere — men den ville heller ikke truffet, siden nøkkelen er unik
 * per spiller. `private` sier det eksplisitt i stedet for å hvile på at
 * nøkkelen tilfeldigvis redder oss. Samme resonnement som da Cache-Control ble
 * fjernet fra answer-distribution-ruten.
 */
export function decideStandingsCache(input: StandingsCacheInput): string {
  const closed = isQuizClosed(input.closesAt, input.now)

  if (input.personalized) {
    return closed ? `private, max-age=${PRIVATE_CLOSED_MAX_AGE}` : 'private, no-store'
  }

  const sMaxAge = closed ? SHARED_CLOSED_S_MAXAGE : SHARED_OPEN_S_MAXAGE
  return `public, s-maxage=${sMaxAge}, max-age=0`
}
