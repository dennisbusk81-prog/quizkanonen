// ── Arkivkopi: den RENE beslutningen om hva en arkivkopi består av ───────────
//
// Bygget 26. august 2026, etter samme deling som lib/premium-state.ts /
// premium-state-io.ts og lib/analytics-event.ts / analytics.ts: beslutningen
// om HVA som skal opprettes testes for seg, uavhengig av ruten som senere
// skal gjøre selve skrivingen. Denne filen kjenner ingen Supabase, ingen
// fetch, ingen klokke. Datamodell-grunnlaget står i
// .claude/QK_KARTLEGGING_ARKIV_KOPIRUTE_26AUG.md (731b383).
//
// ── INNGANGEN ER EN LISTE MED SPØRSMÅLS-ID-ER, IKKE EN KILDE-QUIZ-ID ────────
// «Spill quiz 47 på nytt» er bare id-ene fra quiz 47 i order_index-rekkefølge;
// en generert quiz er femten id-er fra et filter. Samme funksjon, samme rute
// senere. questions.quiz_id er én enkelt FK (ingen koblingstabell), så en
// arkivquiz kan aldri PEKE på eksisterende spørsmål — radene kopieres alltid.
//
// ── UTGANGEN BYGGES FRA BUNNEN — INGEN SPREAD ───────────────────────────────
// Samme grep som decideAnalyticsEvent og buildAccessCode (som erstattet
// `insert(body)`): hver utgangskolonne er en eksplisitt linje her. En
// kilderad kan derfor ikke lekke et felt inn i kopien, heller ikke i
// framtiden — og «bruksdata havner aldri i utgangen» kan bevises ved
// UTTØMMING i test (eksakt nøkkelsett), ikke stikkprøver.
//
// Bruksdata som BEVISST holdes utenfor spørsmålskopien:
//   usage_count / last_used_at — «minst brukt / sist brukt» er sorteringen
//     Dennis skal styre etter med 5000 spørsmål i banken. classics/copy
//     bumper kilden per kopi; arkivruten skal IKKE arve den semantikken
//     (Dennis-beslutning 26. august) — ellers ødelegger populariteten til
//     arkivet sorteringen. Nye rader får DB-default (0/NULL): en
//     avspillingskopi er ikke et «bruk» i bank-forstand.
//   is_classic — bank-markering, ikke innhold (classics/copy setter også
//     false på nye rader).
//   id / quiz_id / created_at — identitet; settes av databasen og ruten.
//     Utgangsradene har med vilje INGEN quiz_id: den nye quizens id finnes
//     ikke før quiz-raden er satt inn, så ruten legger den på etterpå.
//
// Kviz-kolonner som BEVISST er eksplisitte i utgangen:
//   quiz_type='archive'   — faller dermed ut av real-quiz-hvitelisten
//                           (lib/real-quiz-population.ts) med vilje.
//   opens_at/closes_at=NULL — «ingen tidsgrense»; selv-gater alle tidsstyrte
//                           lesere inkl. oppgjør og varsling (migrasjon
//                           20260826000000, kjørt i prod; NONNULL-sveipet
//                           4c351d5/ed74dce). Funksjonen trenger derfor
//                           ingen klokke — det finnes ingen tid å skrive.
//   hide_leaderboard_until_closed=false — ARVES ALDRI (Dennis-beslutning
//                           26. august): uten stengetid ville flagget betydd
//                           «skjult for alltid». MÅ stå eksplisitt, ikke
//                           utelates: DB-defaulten er TRUE, så en utelatt
//                           kolonne hadde gjeninnført fella bakveien.
//   is_test=false         — arkivspilling er ekte spilling.
//   is_active=true        — påkrevd for at anon-lesingen i spillsiden ser
//                           quizen i det hele tatt (samme grunn som i
//                           .claude/QK_TESTQUIZ_OPPSKRIFT.md).
// Alle andre quizzes-kolonner utelates med vilje og får DB-default —
// deriblant season_points_awarded=false (ærlig: aldri gjort opp; NULL-datoene
// gater oppgjøret) og de døde reminder_sent_at/push_sent_at som aldri skal
// skrives.
//
// ── TITTELEN ER EN INNGANG, IKKE EN BESLUTNING ──────────────────────────────
// quizzes.title er NOT NULL, og en kopi som heter det samme som originalen er
// forvirrende i admin — men FORMATET er Dennis' valg og er ikke tatt ennå.
// Funksjonen tar derfor ferdig tittel som parameter og validerer bare at den
// ikke er tom. Formatbeslutningen hører hjemme i rute-økten.
//
// ── KILDEQUIZENS METADATA TAS IMOT FOR Å BEVISELIG IKKE ARVES ───────────────
// Funksjonen leser ALDRI noe fra sourceQuiz. Parameteren finnes fordi ruten
// kommer til å ha kildequizen i hånden, og «flagget arves ikke, uansett hva
// kilden har» skal være en testbar egenskap ved signaturen — ikke en
// antagelse om at ingen framtidig kaller frister.
//
// ── order_index: SAMMENHENGENDE FRA 0 I ID-LISTENS REKKEFØLGE ───────────────
// Bestilt eksplisitt 26. august. To kjente motsignaler er RAPPORTERT, ikke
// designet rundt: (1) alle eksisterende skrivere er 1-baserte, og en mulig
// CHECK (order_index > 0) i prod er aldri verifisert (se kommentarene i
// migrasjon 20260731000000/20260824000000) — må avklares FØR rute-økten
// setter inn første rad; (2) delete_question_and_renumber renummererer til
// 1..N, så invariansen overlever ikke en admin-sletting. Leserne sorterer på
// order_index og antar ingen startverdi.

/** Innholdskolonnene som kopieres — samme felt som spillestiens SELECT
 *  (app/api/quiz/[id]/questions/route.ts:25) trenger, pluss id for oppslag. */
export type ArchiveSourceQuestion = {
  id: string
  question_text: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
  correct_answer: string
  correct_answers: string[] | null
  explanation: string | null
  category: string | null
  time_limit_seconds: number | null
  shuffle_options: boolean
}

/** Tas imot kun for å beviselig ignoreres — se filhodet. */
export type ArchiveSourceQuiz = {
  quiz_type?: string | null
  is_test?: boolean | null
  hide_leaderboard_until_closed?: boolean | null
  opens_at?: string | null
  closes_at?: string | null
} | null

export type ArchiveQuestionRow = {
  question_text: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
  correct_answer: string
  correct_answers: string[] | null
  explanation: string | null
  category: string | null
  time_limit_seconds: number | null
  shuffle_options: boolean
  order_index: number
}

export type ArchiveQuizRow = {
  title: string
  quiz_type: 'archive'
  opens_at: null
  closes_at: null
  hide_leaderboard_until_closed: false
  is_test: false
  is_active: true
}

export type ArchiveCopyResult =
  | { ok: true; quiz: ArchiveQuizRow; questions: ArchiveQuestionRow[] }
  | { ok: false; error: 'tom-tittel' | 'tom-liste' | 'duplikat-id' | 'ukjent-id'; detail?: string }

export function buildArchiveCopy(input: {
  title: string
  questionIds: string[]
  sourceQuestions: ArchiveSourceQuestion[]
  sourceQuiz: ArchiveSourceQuiz
}): ArchiveCopyResult {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title.length === 0) return { ok: false, error: 'tom-tittel' }
  if (input.questionIds.length === 0) return { ok: false, error: 'tom-liste' }

  // Duplikat i id-listen er en kallerfeil, ikke en bestilling av to kopier:
  // ingen legitim inngang («quiz 47 på nytt», et filter) produserer duplikater.
  const seen = new Set<string>()
  for (const id of input.questionIds) {
    if (seen.has(id)) return { ok: false, error: 'duplikat-id', detail: id }
    seen.add(id)
  }

  const byId = new Map(input.sourceQuestions.map((q) => [q.id, q]))

  const questions: ArchiveQuestionRow[] = []
  for (const [i, id] of input.questionIds.entries()) {
    const src = byId.get(id)
    if (!src) return { ok: false, error: 'ukjent-id', detail: id }
    questions.push({
      question_text: src.question_text,
      option_a: src.option_a,
      option_b: src.option_b,
      option_c: src.option_c,
      option_d: src.option_d,
      // Fasiten er to kolonner som alltid skrives sammen (CLAUDE.md).
      // Kilderaden holder allerede invarianten; kopier verbatim — men arrayet
      // som VERDI, ikke som referanse, så utgangen aldri deler minne med
      // kilden.
      correct_answer: src.correct_answer,
      correct_answers: src.correct_answers === null ? null : [...src.correct_answers],
      explanation: src.explanation,
      category: src.category,
      time_limit_seconds: src.time_limit_seconds,
      shuffle_options: src.shuffle_options,
      order_index: i,
    })
  }

  return {
    ok: true,
    quiz: {
      title,
      quiz_type: 'archive',
      opens_at: null,
      closes_at: null,
      hide_leaderboard_until_closed: false,
      is_test: false,
      is_active: true,
    },
    questions,
  }
}
