// ── Arkiv-gatene på SPILLESTIENS rangeringskall ─────────────────────────────
//
// Bygget 29. august 2026 for å lukke et testhull som ble rapportert da
// arkivflaten ble bygget 27. august ([ARK-1] steg 1C): åtte rangeringskall i
// app/quiz/[id]/page.tsx var gatet på `isArchive`, og hvert eneste ett av
// leddene kunne fjernes uten at én test ble rød. Beviset var lesning.
//
// ── HVORFOR EN EGEN MODUL, OG IKKE BARE EN KILDETEKST-TEST ──────────────────
// npm test kjører kun lib/**/*.test.ts under Node sin egen runner — ingen
// jsdom, ingen React-rendering. En kildetekst-test (husets mønster, se
// lib/dead-session-finish-wiring.test.ts) kan derfor bevise at vakten STÅR
// der, men ikke at kallet FORTSATT FYRER for en fredagsquiz. Den halvdelen er
// like viktig: en test som bare viser at noe er av, godtar at alt er av.
//
// Beslutningen bor derfor her, som åtte rene predikater med hele det
// omkringliggende vilkåret inne i seg — ikke bare arkiv-leddet. Da feller
// lib/archive-ranking-gates.test.ts begge retningene på ekte
// (archive → false, weekly → true), og lib/archive-ranking-wiring.test.ts
// feller at kallstedene faktisk spør. Samme deling som
// lib/archive-play-gate.ts (ren beslutning) + dens rutetest.
//
// ── HVORFOR HELE VILKÅRET, IKKE BARE `!isArchive` ───────────────────────────
// Et predikat som kun svarte «er dette arkiv?» ville flyttet ett ledd ut og
// latt resten stå igjen i komponenten — der de fortsatt kunne forsvinne
// stille. Verre: `shouldFetchPremiumInterludeRanking` og
// `shouldFetchSpanInterludeRanking` er ikke uavhengige. De deler
// `isLoggedIn && placementReady` og splittes på `isPremium`, og gates bare den
// ene for arkiv, faller premium-spilleren STILLE ned i spenn-stien i stedet
// for til stillhet. Den feilen er kun synlig når begge to er i samme testbare
// enhet — se testen «premium-spilleren faller ikke ned i spenn-stien».
//
// ── QUIZTYPEN KAN VÆRE UKJENT ───────────────────────────────────────────────
// Alle åtte tar `quizType: string | null | undefined`. Ukjent type (raden ikke
// lastet ennå) behandles som IKKE-arkiv, altså kallet fyrer. Det er bevisst og
// speiler nøyaktig oppførselen til begge formene som sto i komponenten fra før
// — `quiz?.quiz_type !== 'archive'` og `!(quiz?.quiz_type === 'archive')` er
// begge sanne for null. Ingen av de åtte kallstedene er nåbare før raden er
// lastet, så grenen er uoppnåelig i praksis; den er dokumentert her fordi to
// ULIKE skrivemåter som oppfører seg likt er verdt å binde fast, ikke fordi
// den er en risiko. Å gjøre den strengere ville vært en atferdsendring smuglet
// inn i en testrunde.

/** Quiztypen slik den ligger på `quizzes.quiz_type`. */
export type QuizTypeInput = string | null | undefined

/**
 * Den ene arkiv-testen alle åtte deler. Eksportert slik at kallstedene aldri
 * skriver strengen `'archive'` selv — da finnes det ett sted å endre den, og
 * en skrivefeil kan ikke gjøre en gate stille virkningsløs.
 */
export function isArchiveQuiz(quizType: QuizTypeInput): boolean {
  return quizType === 'archive'
}

/**
 * G1 — intern org-plassering på resultatskjermen.
 * `GET /api/leaderboard/{id}?org=` i den egne effekten (ikke i finishQuiz,
 * fordi myOrgs lastes asynkront).
 *
 * Arkiv: kallet ville truffet KOPIENS leaderboard — et felt med kun denne
 * spilleren — og vist «1. plass av 1». Spøkelsesplasseringen mot det frosne
 * feltet er arkivets eneste rangeringsflate.
 */
export function shouldFetchInternalPlacement(args: {
  quizType: QuizTypeInput
  phase: string
  placementMode: string
}): boolean {
  if (args.phase !== 'finished') return false
  if (isArchiveQuiz(args.quizType)) return false
  return args.placementMode === 'internal-only' || args.placementMode === 'both'
}

/**
 * G2 — topp-3 i fetchData sin already_played-gren.
 * `GET /api/quiz/{id}/standings`.
 *
 * Hentes her OG i fase-effekten (G3) med vilje: fase-effekten kan miste
 * fase-endringen i already_played-stien pga. timing med loading-state. Begge
 * må derfor gates — gates bare den ene, henter den andre likevel.
 *
 * Arkiv: standings på KOPIENS id er et felt med kun denne spilleren — en
 * «Topp 3» med henne alene.
 */
export function shouldFetchAlreadyPlayedTop3OnLoad(args: {
  quizType: QuizTypeInput
}): boolean {
  return !isArchiveQuiz(args.quizType)
}

/**
 * G3 — topp-3 fra fase-effekten.
 * `GET /api/quiz/{id}/standings`.
 *
 * Kun for 'already_played': på 'finished' hentes topp-3 sammen med
 * plasseringen i finishQuiz (G8), fra samme /standings-liste i samme
 * øyeblikk, så de to kan ikke divergere.
 */
export function shouldFetchPhaseTop3(args: {
  quizType: QuizTypeInput
  phase: string
}): boolean {
  if (args.phase !== 'already_played') return false
  return !isArchiveQuiz(args.quizType)
}

/**
 * G4 — live plassering UNDER spilling.
 * `GET /api/quiz/{id}/ranking-snapshot` fra fetchLiveRank.
 *
 * Arkiv: ingen plassering under spilling i det hele tatt (27. august 2026) —
 * kallet ville dessuten målt mot kopiens tomme felt.
 *
 * `showLivePlacement` er quizens eget flagg og er bevisst med her: begge to er
 * grunner til å tie, og et predikat som bare kjente den ene ville latt
 * kallstedet beholde et løst hvis-ledd.
 */
export function shouldFetchLiveRank(args: {
  quizType: QuizTypeInput
  showLivePlacement: boolean | null | undefined
  answeredSoFar: number
  minAnsweredForPlacement: number
}): boolean {
  if (!args.showLivePlacement) return false
  if (isArchiveQuiz(args.quizType)) return false
  return args.answeredSoFar >= args.minAnsweredForPlacement
}

/**
 * G5 — rival, rankingSnapshot og duellforslag ved quiz-start.
 * `GET /api/quiz/rival`.
 *
 * Arkiv: alle tre utledes av forsøkene på DENNE quiz-id-en, og kopien har
 * ingen andre spillere. Uten data holder render-vilkårene flatene skjult av
 * seg selv — men kallet er likevel bortkastet, og et tomt svar er ikke det
 * samme som ikke å spørre.
 */
export function shouldFetchRival(args: {
  quizType: QuizTypeInput
  hasAccessToken: boolean
}): boolean {
  if (!args.hasAccessToken) return false
  return !isArchiveQuiz(args.quizType)
}

/**
 * G6 — premium-blokken på mellomskjermen (goToNext).
 * `GET /api/quiz/live-ranking` — spenn + plassering + naboer i ETT kall.
 *
 * Se modulkommentaren: G6 og G7 må leses sammen. Gates bare denne, faller
 * premium-spilleren ned i G7 sin spenn-sti i stedet for til stillhet.
 */
export function shouldFetchPremiumInterludeRanking(args: {
  quizType: QuizTypeInput
  isLoggedIn: boolean
  isPremium: boolean
  placementReady: boolean
}): boolean {
  if (!args.isLoggedIn || !args.isPremium || !args.placementReady) return false
  return !isArchiveQuiz(args.quizType)
}

/**
 * G7 — spenn-stien på mellomskjermen (goToNext), for ikke-Premium.
 * `GET /api/quiz/{id}/ranking-snapshot`.
 */
export function shouldFetchSpanInterludeRanking(args: {
  quizType: QuizTypeInput
  isLoggedIn: boolean
  isPremium: boolean
  placementReady: boolean
}): boolean {
  if (!args.isLoggedIn || args.isPremium || !args.placementReady) return false
  return !isArchiveQuiz(args.quizType)
}

/**
 * G8 — hele pynte-blokken ved MÅLSTREKEN (finishQuiz).
 * `GET /api/quiz/{id}/standings` + `GET /api/leaderboard/{id}`-fallbacken,
 * begge under ett felles timeout-budsjett.
 *
 * Arkiv: begge leser KOPIENS felt — kun denne spilleren — og ville satt
 * «nr. 1 av 1». Arkivets plassering hentes i stedet fra det frosne feltet av
 * spøkelsesplassering-effekten når resultatskjermen står.
 */
export function shouldFetchFinishExtras(args: {
  quizType: QuizTypeInput
}): boolean {
  return !isArchiveQuiz(args.quizType)
}
