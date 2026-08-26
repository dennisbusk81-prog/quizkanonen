// ── Arkiv-opprettelse: rutens RENE regler (kvote + kildegate + inngangstak) ──
//
// Bygget 26. august 2026 sammen med POST /api/arkiv (app/api/arkiv/route.ts).
// Selve INNHOLDET i kopien bestemmes av buildArchiveCopy (lib/archive-copy.ts)
// — denne filen eier reglene for hvem som får opprette, hvor ofte, og hvilke
// kilder som i det hele tatt er lovlige. Ingen I/O her; tellingen og
// oppslagene ligger i ruten (samme deling som lib/duel-quota.ts).
//
// ── KVOTEN: admin_actions-formen (lag 3), ikke Upstash ──────────────────────
// /api/arkiv er den første ikke-admin quiz-opprettelsen i kodebasen. Hver
// godkjent forespørsel skriver 1 quiz-rad + opptil MAX_ARCHIVE_QUESTION_IDS
// spørsmålsrader, så grensen må overleve kalde starter — derfor autoritativ
// telling i admin_actions (som duel-/invite-kvotene), med in-memory IP-brems
// som billig førstelag i ruten. IKKE flytt dette til rate-limit-shared:
// husregelen er at flater med lag 3 ikke også skal ha delt teller.
export const ARCHIVE_CREATED_ACTION = 'archive_quiz_created'

/** Tellevindu: rullerende døgn, samme form som DUEL_SENDER_WINDOW_MS. */
export const ARCHIVE_CREATE_WINDOW_MS = 24 * 60 * 60 * 1000

// Satt mot faktisk bruk: én arkivkveld er en håndfull «spill på nytt» /
// genererte quizer — ti dekker tung legitim bruk med margin. Samtidig er ti
// per døgn maks ~510 nye rader (10 × (1 + 50)) fra en fiendtlig premium-konto,
// i stedet for ubegrenset radvekst. Tallet er en første dimensjonering, ikke
// målt trafikk — juster når arkivet har reelle brukere.
export const ARCHIVE_CREATE_MAX_PER_DAY = 10

/**
 * Tak på id-listen per kall. Største reelle quiz er ~15–20 spørsmål og en
 * generert quiz ~15; 50 gir slingringsmonn og holder `.in()`-oppslaget langt
 * under PostgREST-grensen (~390 id-er, se memory/reference-postgrest-limits).
 */
export const MAX_ARCHIVE_QUESTION_IDS = 50

/**
 * Tak på tittel-lengde. buildArchiveCopy validerer kun ikke-tom (formatet er
 * Dennis' åpne beslutning); dette er ren inngangshygiene på en offentlig
 * skriverute — quizzes.title er TEXT uten CHECK, og uten tak kunne en klient
 * lagre megabyte i én kolonne.
 */
export const MAX_ARCHIVE_TITLE_LENGTH = 120

export type ArchiveCreateQuotaDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; message: string }

/**
 * Har kontoen brukt opp døgnkvoten for arkiv-opprettelser?
 * Ren funksjon — samme form som decideDuelSenderQuota.
 */
export function decideArchiveCreateQuota({
  createdLastDay,
}: {
  /** Antall arkivquizer denne kontoen har opprettet i vinduet. */
  createdLastDay: number
}): ArchiveCreateQuotaDecision {
  if (createdLastDay >= ARCHIVE_CREATE_MAX_PER_DAY) {
    return {
      allowed: false,
      message:
        'Du har opprettet mange arkivquizer det siste døgnet. Vent litt før du lager flere.',
    }
  }
  return { allowed: true, remaining: ARCHIVE_CREATE_MAX_PER_DAY - createdLastDay }
}

// ── KILDEGATEN: fasiten til en uåpnet/åpen quiz må ikke kunne hentes ────────
//
// Ruten tar en klientstyrt liste med spørsmåls-id-er. Uten denne gaten kunne
// en premium-bruker med id-ene til FREDAGENS quiz (opprettet, ennå ikke
// stengt) lage en arkivkopi, spille den, og lese fasiten før quizen stenger —
// samme sårbarhetsklasse som «fasit hentbar på forhånd via /questions»
// (rettet 20. juli 2026), bare gjennom en ny inngang.
//
// Regelen: hvert kildespørsmåls FORELDER-quiz må være (a) funnet, (b) ikke
// testquiz, og (c) STENGT — closes_at satt, gyldig og i fortiden. Alt annet
// avvises, og hullet peker med vilje mot AVSLAG (fail-closed): en quiz-løs
// spørsmålsrad, is_test=NULL eller en uparsbar dato er «vet ikke», og «vet
// ikke» slipper aldri en kilde gjennom en sikkerhetsgate.
//
// Bonus som følger gratis av (c): arkivquizer har selv closes_at=NULL og kan
// dermed aldri være kilde — ingen kopikjeder av kopier.

export type ArchiveSourceParentQuiz = {
  closes_at: string | null
  is_test: boolean | null
} | null

export type ArchiveSourceGateRow = {
  id: string
  quiz: ArchiveSourceParentQuiz
}

export type ArchiveSourceGateDecision =
  | { allowed: true }
  | {
      allowed: false
      reason: 'mangler-kildequiz' | 'kilde-testquiz' | 'kilde-ikke-stengt'
      questionId: string
    }

/**
 * Er samtlige kildespørsmål lovlige å kopiere til et arkiv?
 * Ren funksjon; `now` sendes inn så gaten er deterministisk i test.
 * En tom liste er triviellt lovlig her — «tom bestilling» eies av
 * buildArchiveCopy ('tom-liste'), ikke av sikkerhetsgaten.
 */
export function decideArchiveSourceEligibility(
  rows: ArchiveSourceGateRow[],
  now: Date
): ArchiveSourceGateDecision {
  for (const row of rows) {
    if (!row.quiz) {
      return { allowed: false, reason: 'mangler-kildequiz', questionId: row.id }
    }
    // Krav om `=== false`, ikke `!== true`: NULL er «vet ikke» og avvises.
    if (row.quiz.is_test !== false) {
      return { allowed: false, reason: 'kilde-testquiz', questionId: row.id }
    }
    const closedAtMs =
      row.quiz.closes_at === null ? NaN : new Date(row.quiz.closes_at).getTime()
    // NaN (NULL eller uparsbar dato) feiler Number.isFinite → avslag. En rå
    // `new Date(x) > now`-sammenligning ville tvert imot SLUPPET søppel
    // gjennom (NaN-sammenligninger er false begge veier).
    if (!Number.isFinite(closedAtMs) || closedAtMs > now.getTime()) {
      return { allowed: false, reason: 'kilde-ikke-stengt', questionId: row.id }
    }
  }
  return { allowed: true }
}
