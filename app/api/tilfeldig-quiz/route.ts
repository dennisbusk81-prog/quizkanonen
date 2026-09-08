import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUserPremium } from '@/lib/premium-check'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { QUIZ_CATEGORIES } from '@/lib/quiz-categories'
import { osloMonthStartUtcIso } from '@/lib/oslo-time'
import {
  GENERATED_QUIZ_QUESTION_COUNT,
  GENERATED_QUIZ_TITLE,
  decideGeneration,
} from '@/lib/generated-quiz-rules'
import { fetchPoolQuestionIds, sampleDistinct } from '@/lib/generated-quiz-pool'
import { buildArchiveCopy, type ArchiveSourceQuestion } from '@/lib/archive-copy'
import { writeArchiveCopy } from '@/lib/archive-copy-write'
import { decideArchiveSourceEligibility } from '@/lib/archive-create-rules'
import type { Loaded } from '@/lib/fetch-result'

// ── POST /api/tilfeldig-quiz — generer en quiz fra biblioteket («kanonkule») ─
//
// Bygget 8. september 2026. Inngangen er en KATEGORI (eller ingen), aldri
// spørsmåls-id-er: tok ruten id-er fra klienten, kunne en premium-bruker
// plukke fritt fra de 4040 bankspørsmålene og i praksis lese ut hele
// biblioteket, femten om gangen. Ruten velger id-ene selv, server-side
// (lib/generated-quiz-pool.ts).
//
// Rekkefølgen er bestillingens, og den er mutasjonstestet i
// lib/tilfeldig-quiz-route.test.ts:
//   1. les brukerens plan            (getUserPremium — «vet ikke» → 503)
//   2. tell genereringer denne måneden (quiz_generations — «vet ikke» → 503)
//   3. avvis hvis kvoten er brukt opp  (429)
//   4. avvis kategorivalg for gratis   (403)
//   5. velg id-er                      (pulje + trekning)
//   6. lag quizen via arkivets kopieringssti (buildArchiveCopy + writeArchiveCopy)
//   7. bump usage_count/last_used_at på KILDERADENE (RPC bump_question_usage)
//   8. skriv én rad i ledgeren (quiz_generations)
// Reglene for 1–4 bor i lib/generated-quiz-rules.ts (rent, testdekket);
// ruten gjentar ingen av dem.
//
// ── KVOTEN ER EN LEDGER, IKKE EN TELLER ─────────────────────────────────────
// Forbruket er count(*) i quiz_generations siden norsk månedsstart
// (lib/oslo-time.ts). Ingen kolonne på profiles, ingenting å nullstille, og
// en slettet quiz gir ikke kula tilbake (quiz_id ON DELETE SET NULL). Se
// migrasjon 20260908000000.
//
// ── DEN GENERERTE QUIZEN ER quiz_type='archive', source_quiz_id NULL ────────
// Det er den eksisterende konvensjonen (migrasjon 20260827000000 kaller NULL
// «normalen for genererte quizer»). INGEN ny quiz_type: en ny verdi ville
// falt gjennom decideArchivePlayGate i start-attempt, og da kunne
// gratisbrukere spilt en generert quiz uten port. Konsekvensen av å
// gjenbruke 'archive' er løst i PORTEN, ikke med en ny type: fram til
// 8. september 2026 krevde spill-porten Premium for ALLE arkivquizer, så en
// gratisbrukers to månedlige kuler produserte quizer hun ikke fikk starte.
// Nå er regelen «premium ELLER eier» — eierskapet er ledger-raden denne
// ruten skriver i steg 8 (quiz_id + user_id), lest av
// lib/generated-quiz-ownership.ts og avgjort i lib/archive-play-gate.ts.
// Det gjør ledger-skrivingen til mer enn bokføring: feiler den (loggen
// «LEDGER-SKRIVING FEILET» under), er quizen opprettet men kan ikke startes
// av en gratisbruker.
//
// ── KILDEBUMPEN — HER, OG KUN HER ───────────────────────────────────────────
// /api/arkiv bumper med vilje ikke: en reprise av quiz 47 er ikke ny bruk
// av spørsmålene. GENERERING er det — det er en ny quiz satt sammen av
// bankspørsmål, og «minst brukt / sist brukt» skal se den. Bumpen er én
// RPC etter at kopien er bekreftet; PostgREST kan ikke uttrykke
// `usage_count + 1` i en .update(), og 15 les-så-skriv ville vært et
// tapt-oppdatering-kappløp. Feiler bumpen, er sorteringen litt for slapp —
// logges, velter ikke opprettelsen.

// Lese-/lettskriv-rute: kun egen DB. Samme budsjett som /api/arkiv.
export const maxDuration = 15

/** Samme innholdskolonner som /api/arkiv, + quiz_id og forelderen til gaten. */
const SOURCE_SELECT =
  'id, quiz_id, question_text, option_a, option_b, option_c, option_d, ' +
  'correct_answer, correct_answers, explanation, category, ' +
  'time_limit_seconds, shuffle_options, ' +
  'quiz:quizzes(closes_at, is_test)'

type SourceParentQuiz = { closes_at: string | null; is_test: boolean | null } | null
type SourceRow = ArchiveSourceQuestion & { quiz_id: string | null; quiz: SourceParentQuiz }

const RETRY_ERROR = 'Kunne ikke lage quiz akkurat nå. Prøv igjen om litt.'

export async function POST(request: NextRequest) {
  // Lag 1: billig in-memory IP-brems foran auth- og DB-arbeidet. Den
  // autoritative grensen er månedskvoten i ledgeren (lag 3).
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `tilfeldig-quiz:${ip}`
  const rl = rateLimit(rlKey, 5, 60_000)
  if (!rl.success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 5, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler. Vent litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // ── Inngang: kategori (valgfri). Inngangshygiene, ikke en rettighet ──────
  let body: { category?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ugyldig forespørsel.' }, { status: 400 })
  }
  let category: string | null = null
  if (body.category !== undefined && body.category !== null) {
    if (typeof body.category !== 'string' || !QUIZ_CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: 'Ukjent kategori.' }, { status: 400 })
    }
    category = body.category
  }

  // ── 1. Planen ─────────────────────────────────────────────────────────────
  const premium = await getUserPremium(user.id)

  // ── 2. Tellingen — denne norske kalendermåneden ───────────────────────────
  const now = Date.now()
  const monthStartIso = osloMonthStartUtcIso(now)
  const { count, error: countError } = await supabaseAdmin
    .from('quiz_generations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', monthStartIso)
  if (countError) {
    console.error('[tilfeldig-quiz POST] kunne ikke telle genereringer:', countError.message)
  }
  const generatedThisMonth: Loaded<number> = countError
    ? { ok: false }
    : { ok: true, value: count ?? 0 }

  // ── 3 + 4. Kvote og kategorisperre — én ren beslutning ───────────────────
  const decision = decideGeneration({ premium, generatedThisMonth, category })
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.error }, { status: decision.status })
  }

  // ── 5. Velg id-er: puljen (bibliotek + stengte ekte quizer), så trekning ──
  const pool = await fetchPoolQuestionIds({ category, nowIso: new Date(now).toISOString() })
  if (!pool.ok) {
    return NextResponse.json({ error: RETRY_ERROR }, { status: 503 })
  }
  if (pool.value.length < GENERATED_QUIZ_QUESTION_COUNT) {
    return NextResponse.json(
      { error: 'Det finnes ikke nok spørsmål i denne kategorien ennå.' },
      { status: 409 }
    )
  }
  const ids = sampleDistinct(pool.value, GENERATED_QUIZ_QUESTION_COUNT)

  // ── 6. Kopieringsstien — les kildene, kildegate, bygg, skriv ──────────────
  const { data: sourceRows, error: sourceError } = await supabaseAdmin
    .from('questions')
    .select(SOURCE_SELECT)
    .in('id', ids)
  if (sourceError) {
    console.error('[tilfeldig-quiz POST] kunne ikke lese kildespørsmål:', sourceError.message)
    return NextResponse.json({ error: RETRY_ERROR }, { status: 503 })
  }
  const rows = (sourceRows ?? []) as unknown as SourceRow[]

  // Kildegaten kjøres UANSETT, som backstop: puljen filtrerer, men gaten er
  // den som feller. allowBankRows: true er den eksplisitte grenen for
  // biblioteksrader — id-ene er valgt server-side, ikke av klienten.
  const gate = decideArchiveSourceEligibility(
    rows.map((r) => ({ id: r.id, quiz_id: r.quiz_id, quiz: r.quiz })),
    new Date(now),
    { allowBankRows: true }
  )
  if (!gate.allowed) {
    // Puljen og gaten er uenige — det er en kodefeil, ikke en forbigående
    // tilstand. Logg hvilken rad, svar 500 (ikke 503: «prøv igjen» ville
    // vært usant).
    console.error(
      `[tilfeldig-quiz POST] kildegaten avviste et pulje-spørsmål (${gate.reason}): ${gate.questionId}`
    )
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // Kilderadene sendes som de er: SourceRow utvider ArchiveSourceQuestion, og
  // buildArchiveCopy plukker hver kolonne eksplisitt (ingen spread), så
  // quiz/quiz_id på radene kan ikke lekke inn i kopien.
  const sourceQuestions: ArchiveSourceQuestion[] = rows
  // source_quiz_id er ALLTID NULL for en generert quiz — det finnes ikke ett
  // felt å måles mot (lib/archive-source-quiz.ts, krav 1). Ingen telling.
  const built = buildArchiveCopy({
    title: GENERATED_QUIZ_TITLE,
    questionIds: ids,
    sourceQuestions,
    sourceQuiz: null,
    sourceQuizId: null,
  })
  if (!built.ok) {
    console.error(`[tilfeldig-quiz POST] buildArchiveCopy avviste (${built.error}):`, built.detail)
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  const written = await writeArchiveCopy({
    quiz: built.quiz,
    questions: built.questions,
    logPrefix: '[tilfeldig-quiz POST]',
  })
  if (!written.ok) {
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // ── 7. Bump kilderadene — først ETTER bekreftet kopi ──────────────────────
  const { error: bumpError } = await supabaseAdmin.rpc('bump_question_usage', { p_ids: ids })
  if (bumpError) {
    console.error('[tilfeldig-quiz POST] kildebump feilet:', bumpError.message)
  }

  // ── 8. Ledgeren — én rad, planen frosset ──────────────────────────────────
  // Feiler den, er kvoten for SLAPP for neste kall (én gratis kule). Riktig
  // feilretning for en rullet-tilbake opprettelse, men her ER quizen
  // opprettet — så det logges høyt, ikke stille.
  const { error: ledgerError } = await supabaseAdmin.from('quiz_generations').insert({
    user_id: user.id,
    category,
    quiz_id: written.quizId,
    plan: decision.plan,
  })
  if (ledgerError) {
    console.error(
      `[tilfeldig-quiz POST] LEDGER-SKRIVING FEILET — quiz ${written.quizId} for ${user.id} er ikke bokført:`,
      ledgerError.message
    )
  }

  return NextResponse.json(
    { quizId: written.quizId, remaining: decision.remainingAfter },
    { status: 201 }
  )
}
