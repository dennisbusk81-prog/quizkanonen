// Server-only — never import this in 'use client' components.
import { supabaseAdmin } from './supabase-admin'
import { readStoredKey } from './answer-key-correction'
import { fetchAllRows } from './paginate'
import {
  computeCategoryStats,
  pickCategoryStrength,
  type CategoryStrength,
} from './category-stats'
import {
  computeParticipationStreak,
  type ParticipationStreak,
  type StreakQuiz,
} from './participation-streak'

// ─── Exported types ──────────────────────────────────────────────────────────

export type HistoryAttempt = {
  id: string
  quiz_id: string
  quiz_title: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  completed_at: string
  rank: number | null
  total_players: number | null
}

export type Progresjon =
  | { type: 'first'; diff: number }
  | { type: 'early'; diff: number }
  | { type: 'trend'; diff: number }

export type PlayerStats = {
  total_attempts: number
  total_correct: number
  total_questions: number
  best_streak: number
  avg_score_pct: number
  beste_plassering: number | null
  bedre_enn_prosent: number | null
  raskere_enn_prosent: number | null
  progresjon: Progresjon | null
  // Sterkeste/svakeste kategori på tvers av ALL brukerens historikk — ikke én
  // quiz. Begge er null når færre enn to kategorier klarer terskelen; se
  // pickCategoryStrength() i lib/category-stats.ts for reglene.
  sterkeste_kategori: string | null
  svakeste_kategori: string | null
  // Andel riktige i de to kategoriene over, i prosent, med råtallene bak.
  // Alle seks er null nøyaktig når kategorien er null — se CategoryStrength i
  // lib/category-stats.ts.
  //
  // NB: dette er andel av BESVARTE spørsmål i kategorien over hele
  // historikken, ikke andel av alle spørsmål i banken i den kategorien.
  //
  // `_riktige`/`_besvart` vises sammen med prosenten fordi terskelen er 3
  // svar: «100 %» er ofte 3 av 3, og prosenten alene overselger det.
  sterkeste_kategori_prosent: number | null
  sterkeste_kategori_riktige: number | null
  sterkeste_kategori_besvart: number | null
  svakeste_kategori_prosent: number | null
  svakeste_kategori_riktige: number | null
  svakeste_kategori_besvart: number | null
  // Fredagsquizer på rad. IKKE det samme som `best_streak` over, som er
  // riktige svar på rad inne i ÉN quiz (attempts.correct_streak). Se
  // lib/participation-streak.ts.
  deltakelsesrekke: number
  lengste_deltakelsesrekke: number
}

export type AttemptAnswerDetail = {
  question_id: string
  question_text: string
  selected_answer: string | null       // letter code: 'A' | 'B' | 'C' | 'D' | null
  selected_answer_text: string | null  // option text, null if no answer given
  is_correct: boolean
  correct_answers: string[]            // letter code(s), one per correct option
  correct_answer_texts: string[]       // option text(s), same order as correct_answers
  time_ms: number
}

export type AttemptDetail = {
  attempt_id: string
  quiz_id: string
  quiz_title: string
  completed_at: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  rank: number | null
  total_players: number | null
  answers: AttemptAnswerDetail[]
}

export type PlayerHistoryResult = {
  history: HistoryAttempt[]
  stats: PlayerStats
  // Pagination — present when the caller passes page/pageSize
  total?: number
  page?: number
  pageSize?: number
}

// ─── Internal types ───────────────────────────────────────────────────────────

type RawAttemptForRank = {
  id: string
  quiz_id: string
  correct_answers: number
  total_time_ms: number
}

type AttemptRank = {
  rank: number
  total_players: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

/**
 * For each attempt in userAttempts, compute rank and total_players by fetching
 * all completed attempts for the relevant quiz_ids in one query.
 * Rank = number of attempts that beat this one + 1.
 * Tie-breaking: higher correct_answers wins; equal correct_answers, lower total_time_ms wins.
 */
async function computeRanks(
  userAttempts: RawAttemptForRank[]
): Promise<Map<string, AttemptRank>> {
  if (userAttempts.length === 0) return new Map()

  const quizIds = [...new Set(userAttempts.map((a) => a.quiz_id))]

  // OBS: PostgREST kutter stille ved 1000 rader (db-max-rows) — en .limit()
  // over 1000 gjør ingenting og ga tidligere falsk trygghet her. Spørringen er
  // altså IKKE beskyttet mot vekst: over 1000 attempts på tvers av quizIds blir
  // rangeringen feil. TODO(paginering): bruk fetchAllRows fra lib/paginate.ts.
  const { data } = await supabaseAdmin
    .from('attempts')
    .select('quiz_id, correct_answers, total_time_ms')
    .in('quiz_id', quizIds)
    .not('correct_streak', 'is', null)

  if (!data) return new Map()

  // Group all attempts by quiz_id
  const byQuiz = new Map<string, Array<{ correct_answers: number; total_time_ms: number }>>()
  for (const row of data) {
    const list = byQuiz.get(row.quiz_id) ?? []
    list.push({ correct_answers: row.correct_answers, total_time_ms: row.total_time_ms })
    byQuiz.set(row.quiz_id, list)
  }

  const result = new Map<string, AttemptRank>()
  for (const attempt of userAttempts) {
    const all = byQuiz.get(attempt.quiz_id) ?? []
    const betterCount = all.filter(
      (a) =>
        a.correct_answers > attempt.correct_answers ||
        (a.correct_answers === attempt.correct_answers &&
          a.total_time_ms < attempt.total_time_ms)
    ).length
    result.set(attempt.id, { rank: betterCount + 1, total_players: all.length })
  }

  return result
}

/**
 * Computes score progression based on attempt history:
 * - 'first'  — only 1 attempt played
 * - 'early'  — 2–3 attempts; diff = last score% − first score%
 * - 'trend'  — 4+ attempts; diff = avg score% last 4 weeks − avg score% previous 4 weeks
 *              (falls back to last − first if one period has no data)
 */
function computeProgresjon(
  attempts: Array<{
    correct_answers: number
    total_questions: number
    completed_at: string
  }>
): Progresjon {
  const sorted = [...attempts].sort(
    (a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
  )

  if (sorted.length === 1) {
    return { type: 'first', diff: 0 }
  }

  if (sorted.length <= 3) {
    const firstPct = pct(sorted[0].correct_answers, sorted[0].total_questions)
    const lastPct = pct(
      sorted[sorted.length - 1].correct_answers,
      sorted[sorted.length - 1].total_questions
    )
    return { type: 'early', diff: lastPct - firstPct }
  }

  const nowMs = Date.now()
  const fourWeeksMs = 28 * 24 * 60 * 60 * 1000

  const recentAttempts = sorted.filter(
    (a) => nowMs - new Date(a.completed_at).getTime() < fourWeeksMs
  )
  const prevAttempts = sorted.filter((a) => {
    const ageMs = nowMs - new Date(a.completed_at).getTime()
    return ageMs >= fourWeeksMs && ageMs < 2 * fourWeeksMs
  })

  if (recentAttempts.length > 0 && prevAttempts.length > 0) {
    const avgRecent =
      recentAttempts.reduce((sum, a) => sum + pct(a.correct_answers, a.total_questions), 0) /
      recentAttempts.length
    const avgPrev =
      prevAttempts.reduce((sum, a) => sum + pct(a.correct_answers, a.total_questions), 0) /
      prevAttempts.length
    return { type: 'trend', diff: Math.round(avgRecent - avgPrev) }
  }

  // Fallback: last attempt vs first attempt
  const firstPct = pct(sorted[0].correct_answers, sorted[0].total_questions)
  const lastPct = pct(
    sorted[sorted.length - 1].correct_answers,
    sorted[sorted.length - 1].total_questions
  )
  return { type: 'trend', diff: lastPct - firstPct }
}

function resolveTitle(raw: unknown): string {
  const v = raw as { title: string } | { title: string }[] | null
  if (Array.isArray(v)) return v[0]?.title ?? 'Ukjent quiz'
  return v?.title ?? 'Ukjent quiz'
}

// Samme forsvar som resolveTitle: PostgREST returnerer en embed som objekt
// eller som array avhengig av relasjonens form, og å anta feil form gir null
// uten feilmelding. Målt mot prod 2. august 2026 er denne et objekt — men
// antakelsen står ikke alene her.
function resolveCategory(raw: unknown): string | null {
  const v = raw as { category: string | null } | { category: string | null }[] | null
  if (Array.isArray(v)) return v[0]?.category ?? null
  return v?.category ?? null
}

type CategoryAnswerRow = {
  question_id: string
  is_correct: boolean
  questions: unknown
}

/**
 * Sterkeste/svakeste kategori over ALLE brukerens forsøk.
 *
 * Populasjonen er nøyaktig den samme som resten av getPlayerStats bruker:
 * `attempts.correct_streak IS NOT NULL` = fullført forsøk. Filteret settes på
 * den embeddede attempts-raden (`attempts!inner`), slik at én spørring gjør
 * både avgrensningen og hentingen — ingen `.in()` med en voksende liste av
 * attempt-id-er, og dermed heller ingen berøring med ~390-id-grensen i
 * lib/paginate.ts.
 *
 * `questions(category)` er bevisst en VANLIG embed, ikke `!inner`: et svar på
 * et spørsmål uten kategori skal fortsatt telles (det havner i
 * «Uten kategori»-bøtta og holder summen hel), ikke forsvinne fra grunnlaget.
 *
 * PAGINERING ER IKKE VALGFRI HER. En bruker samler ~20 svarrader per quiz, så
 * en trofast spiller passerer 1000-taket i løpet av omtrent ett år med
 * ukentlig quiz. PostgREST kutter da stille, og nettopp de mest lojale
 * brukerne ville fått kategoritall regnet på en vilkårlig del av historikken
 * sin — uten at noe så galt ut. Se category-strength.pagination.test.ts.
 */
async function fetchCategoryStrength(userId: string): Promise<CategoryStrength> {
  const rows = await fetchAllRows<CategoryAnswerRow>((from, to) =>
    supabaseAdmin
      .from('attempt_answers')
      .select('question_id, is_correct, attempts!inner(user_id, correct_streak), questions(category)')
      .eq('attempts.user_id', userId)
      .not('attempts.correct_streak', 'is', null)
      .range(from, to)
  )

  const answers = rows.map((r) => ({ questionId: r.question_id, isCorrect: r.is_correct }))

  // computeCategoryStats slår opp kategori via questionId → question.id, så
  // hvert spørsmål skal være med ÉN gang uansett hvor mange ganger det er
  // besvart (samme spørsmål kan gå igjen i flere quizer).
  const questions = [
    ...new Map(
      rows.map((r) => [r.question_id, { id: r.question_id, category: resolveCategory(r.questions) }])
    ).values(),
  ]

  return pickCategoryStrength(computeCategoryStats(answers, questions))
}

type StreakQuizRow = { id: string; season_points_awarded: boolean | null }

/**
 * Deltakelsesrekke — hvor mange fredagsquizer på rad brukeren har spilt.
 * Ren logikk og begrunnelse ligger i lib/participation-streak.ts; denne
 * funksjonen gjør kun uthentingen.
 *
 * POPULASJONEN er gjenbruk, ikke en ny definisjon: `is_test = false` +
 * `season_points_awarded` er nøyaktig markørene `fetchRetentionRows()` i
 * lib/retention.ts bruker for «faktisk spilt og gjort opp». Forskjellen er
 * `.lte('opens_at', now)` i stedet for `.eq('season_points_awarded', true)`:
 * kveldens ÅPNE quiz må være med i lista for at en spiller som nettopp har
 * levert skal se rekken telle opp med én gang, og flagget følger med som
 * `settled` slik at den rene funksjonen kan behandle den asymmetrisk.
 * Planlagte quizer (opens_at fram i tid — 6 stykker i prod per 2. august)
 * holdes ute her, ikke i logikken.
 *
 * `quiz_type = 'weekly'` er ETT filter til, som retention IKKE har, og det er
 * bevisst: rekken lover «fredagsquizer på rad», og en bonusquiz er ikke en
 * fredagsquiz. Uten filteret ville en bonusquiz som ble gjort opp brutt rekken
 * til alle som spiller trofast hver fredag, uten at de hadde gjort noe galt.
 * `'weekly'` er samme markør /api/toppliste og /api/org/[slug]/quiz-scores
 * allerede bruker for å skille ut fredagsserien. (Per 2. august er alle 13
 * quizene i prod `weekly`, så filteret endrer ingenting i dag — det er
 * forsikring mot den første bonusquizen.)
 *
 * DELTAKELSE måles på `submitted_at`, IKKE på `correct_streak IS NOT NULL`
 * som resten av getPlayerStats bruker til å avgrense «fullført forsøk».
 * Avviket er bevisst og målt: i prod 2. august 2026 finnes 6 rader med
 * `correct_streak = 0` og `submitted_at = NULL` — alle med 0 riktige, 0 ms og
 * 15 spørsmål, altså forsøk som ble påbegynt og forlatt. De endrer svaret for
 * 6 av 130 spillere, og i ett tilfelle fabrikkerer de en hel rekke: en bruker
 * som aldri svarte på quizen 19.06 ville fått «7 på rad» i stedet for 6.
 * Å ha startet en quiz er ikke å ha deltatt i den.
 *
 * PAGINERING PÅ BEGGE: quizzes vokser med én rad i uka og attempts med én per
 * spiller per quiz, så begge passerer 1000-taket med tiden — og et `.limit()`
 * i nærheten er ikke bevis på noe, databasen har db-max-rows = 1000 og gir
 * 1000 rader uansett hva man ber om. Sekundærsorteringen på `id` er ikke
 * pynt: uten et deterministisk totalorden kan to sider med likt `opens_at`
 * overlappe eller hoppe over rader mellom seg.
 */
async function fetchParticipationStreak(userId: string): Promise<ParticipationStreak> {
  const nowIso = new Date().toISOString()

  const [quizRows, attemptRows] = await Promise.all([
    fetchAllRows<StreakQuizRow>((from, to) =>
      supabaseAdmin
        .from('quizzes')
        .select('id, season_points_awarded')
        .eq('is_test', false)
        .eq('quiz_type', 'weekly')
        .not('opens_at', 'is', null)
        .lte('opens_at', nowIso)
        .order('opens_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<{ quiz_id: string }>((from, to) =>
      supabaseAdmin
        .from('attempts')
        .select('quiz_id')
        .eq('user_id', userId)
        .not('submitted_at', 'is', null)
        .order('quiz_id', { ascending: true })
        .range(from, to)
    ),
  ])

  const quizzes: StreakQuiz[] = quizRows.map((q) => ({
    id: q.id,
    settled: q.season_points_awarded === true,
  }))

  return computeParticipationStreak(quizzes, attemptRows.map((a) => a.quiz_id))
}

type QuestionRow = {
  id: string
  question_text: string
  correct_answer: string
  correct_answers: string[] | null
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
}

function getOptionText(q: QuestionRow, letter: string | null): string | null {
  if (!letter) return null
  const opts: Record<string, string | null | undefined> = {
    A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d,
  }
  return opts[letter.toUpperCase()] ?? letter
}

// ─── Public functions ─────────────────────────────────────────────────────────

export async function getPlayerHistory(
  userId: string,
  opts: { page?: number; pageSize?: number } = {}
): Promise<{ items: HistoryAttempt[]; total: number }> {
  const pageSize = opts.pageSize ?? 50
  const page     = opts.page     ?? 0
  const from     = page * pageSize
  const to       = from + pageSize - 1

  const [{ data, error }, { count }] = await Promise.all([
    supabaseAdmin
      .from('attempts')
      .select(
        'id, quiz_id, correct_answers, total_questions, total_time_ms, correct_streak, completed_at, quizzes(title)'
      )
      .eq('user_id', userId)
      .not('correct_streak', 'is', null)
      .order('completed_at', { ascending: false })
      .range(from, to),
    supabaseAdmin
      .from('attempts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('correct_streak', 'is', null),
  ])

  if (error || !data) return { items: [], total: 0 }

  const ranks = await computeRanks(
    data.map((r) => ({
      id: r.id,
      quiz_id: r.quiz_id,
      correct_answers: r.correct_answers,
      total_time_ms: r.total_time_ms,
    }))
  )

  const items = data.map((row) => {
    const r = ranks.get(row.id)
    return {
      id: row.id,
      quiz_id: row.quiz_id,
      quiz_title: resolveTitle(row.quizzes),
      correct_answers: row.correct_answers,
      total_questions: row.total_questions,
      total_time_ms: row.total_time_ms,
      correct_streak: row.correct_streak ?? null,
      completed_at: row.completed_at,
      rank: r?.rank ?? null,
      total_players: r?.total_players ?? null,
    }
  })

  return { items, total: count ?? 0 }
}

export async function getPlayerStats(userId: string): Promise<PlayerStats> {
  const EMPTY: PlayerStats = {
    total_attempts: 0,
    total_correct: 0,
    total_questions: 0,
    best_streak: 0,
    avg_score_pct: 0,
    beste_plassering: null,
    bedre_enn_prosent: null,
    raskere_enn_prosent: null,
    progresjon: null,
    sterkeste_kategori: null,
    svakeste_kategori: null,
    sterkeste_kategori_prosent: null,
    sterkeste_kategori_riktige: null,
    sterkeste_kategori_besvart: null,
    svakeste_kategori_prosent: null,
    svakeste_kategori_riktige: null,
    svakeste_kategori_besvart: null,
    deltakelsesrekke: 0,
    lengste_deltakelsesrekke: 0,
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch user attempts and global 90-day attempts in parallel
  const [{ data: userAttempts }, { data: globalAttempts }] = await Promise.all([
    supabaseAdmin
      .from('attempts')
      .select(
        'id, quiz_id, correct_answers, total_questions, total_time_ms, correct_streak, completed_at'
      )
      .eq('user_id', userId)
      .not('correct_streak', 'is', null),
    // OBS: PostgREST kutter stille ved 1000 rader (db-max-rows) — det gamle
    // .limit(10_000) gjorde ingenting. Snitt-tallene under regnes derfor i
    // praksis på maks 1000 av 90-dagers-attemptene og er IKKE beskyttet mot
    // vekst. TODO(paginering): bruk fetchAllRows fra lib/paginate.ts.
    supabaseAdmin
      .from('attempts')
      .select('correct_answers, total_questions, total_time_ms')
      .not('correct_streak', 'is', null)
      .gte('completed_at', ninetyDaysAgo),
  ])

  if (!userAttempts || userAttempts.length === 0) return EMPTY

  // Core aggregates
  const total_attempts = userAttempts.length
  const total_correct = userAttempts.reduce((sum, r) => sum + (r.correct_answers ?? 0), 0)
  const total_questions = userAttempts.reduce((sum, r) => sum + (r.total_questions ?? 0), 0)
  const best_streak = Math.max(0, ...userAttempts.map((r) => r.correct_streak ?? 0))
  const avg_score_pct = pct(total_correct, total_questions)

  // Ranks — one extra query to fetch all-quiz attempts.
  // Kategoristyrken er uavhengig av rangeringen og hentes i samme bølge, slik
  // at den ikke koster en ekstra seriell rundtur. Den ligger her og ikke i
  // første Promise.all fordi den da ville blitt betalt også for brukere som
  // returnerer EMPTY over.
  const [ranks, categoryStrength, participation] = await Promise.all([
    computeRanks(
      userAttempts.map((a) => ({
        id: a.id,
        quiz_id: a.quiz_id,
        correct_answers: a.correct_answers,
        total_time_ms: a.total_time_ms,
      }))
    ),
    fetchCategoryStrength(userId),
    fetchParticipationStreak(userId),
  ])

  const allRankValues = [...ranks.values()].map((r) => r.rank)
  const beste_plassering = allRankValues.length > 0 ? Math.min(...allRankValues) : null

  // Global percentiles vs all attempts in last 90 days
  let bedre_enn_prosent: number | null = null
  let raskere_enn_prosent: number | null = null

  if (globalAttempts && globalAttempts.length > 0) {
    // Score percentile: % of global attempts that the user scores higher than
    const globalScores = globalAttempts.map((a) =>
      pct(a.correct_answers ?? 0, a.total_questions ?? 0)
    )
    const worseCount = globalScores.filter((s) => s < avg_score_pct).length
    bedre_enn_prosent = Math.round((worseCount / globalScores.length) * 100)

    // Speed percentile: % of global attempts that are slower than the user
    const userTotalTime = userAttempts.reduce((sum, a) => sum + (a.total_time_ms ?? 0), 0)
    if (total_questions > 0) {
      const userTimePerQ = userTotalTime / total_questions
      const globalTimesPerQ = globalAttempts
        .filter((a) => (a.total_questions ?? 0) > 0)
        .map((a) => (a.total_time_ms ?? 0) / (a.total_questions as number))
      const slowerCount = globalTimesPerQ.filter((t) => t > userTimePerQ).length
      raskere_enn_prosent =
        globalTimesPerQ.length > 0
          ? Math.round((slowerCount / globalTimesPerQ.length) * 100)
          : null
    }
  }

  // Progression
  const progresjon = computeProgresjon(
    userAttempts.map((a) => ({
      correct_answers: a.correct_answers,
      total_questions: a.total_questions,
      completed_at: a.completed_at,
    }))
  )

  return {
    total_attempts,
    total_correct,
    total_questions,
    best_streak,
    avg_score_pct,
    beste_plassering,
    bedre_enn_prosent,
    raskere_enn_prosent,
    progresjon,
    sterkeste_kategori: categoryStrength.sterkeste,
    svakeste_kategori: categoryStrength.svakeste,
    sterkeste_kategori_prosent: categoryStrength.sterkesteProsent,
    sterkeste_kategori_riktige: categoryStrength.sterkesteRiktige,
    sterkeste_kategori_besvart: categoryStrength.sterkesteBesvart,
    svakeste_kategori_prosent: categoryStrength.svakesteProsent,
    svakeste_kategori_riktige: categoryStrength.svakesteRiktige,
    svakeste_kategori_besvart: categoryStrength.svakesteBesvart,
    deltakelsesrekke: participation.current,
    lengste_deltakelsesrekke: participation.longest,
  }
}

/**
 * Returns full details for a single attempt, including per-question answers.
 * Returns null if the attempt does not exist or does not belong to userId.
 */
export async function getAttemptDetail(
  attemptId: string,
  userId: string
): Promise<AttemptDetail | null> {
  // Fetch attempt — the .eq('user_id', userId) doubles as ownership verification
  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from('attempts')
    .select(
      'id, quiz_id, correct_answers, total_questions, total_time_ms, completed_at, quizzes(title)'
    )
    .eq('id', attemptId)
    .eq('user_id', userId)
    .single()

  if (attemptError || !attempt) {
    return null
  }

  // Fetch attempt_answers and questions for this quiz in parallel
  const [{ data: answers }, { data: questions }] = await Promise.all([
    supabaseAdmin
      .from('attempt_answers')
      .select('question_id, selected_answer, is_correct, time_ms')
      .eq('attempt_id', attemptId),
    supabaseAdmin
      .from('questions')
      .select('id, question_text, correct_answer, correct_answers, option_a, option_b, option_c, option_d')
      .eq('quiz_id', attempt.quiz_id),
  ])

  // Build a lookup map for questions
  const questionMap = new Map<string, QuestionRow>()
  for (const q of questions ?? []) {
    questionMap.set(q.id, q as QuestionRow)
  }

  // Compute rank
  const ranks = await computeRanks([
    {
      id: attempt.id,
      quiz_id: attempt.quiz_id,
      correct_answers: attempt.correct_answers,
      total_time_ms: attempt.total_time_ms,
    },
  ])
  const rank = ranks.get(attempt.id)

  const mappedAnswers: AttemptAnswerDetail[] = (answers ?? []).map((a) => {
    const q = questionMap.get(a.question_id) ?? null
    const selectedLetter = (a.selected_answer as string | null) ?? null
    // readStoredKey() er samme fallback som scoringen i submit/route.ts og
    // spillskjermen i app/quiz/[id]/page.tsx bruker: correct_answers[] vinner
    // når den har innhold, ellers faller den tilbake på enkelt-kolonnen.
    const correctLetters = q ? readStoredKey(q) : []
    return {
      question_id: a.question_id,
      question_text: q?.question_text ?? '',
      selected_answer: selectedLetter,
      selected_answer_text: q ? getOptionText(q, selectedLetter) : null,
      is_correct: a.is_correct as boolean,
      correct_answers: correctLetters,
      correct_answer_texts: correctLetters.map((l) => (q ? getOptionText(q, l) ?? l : l)),
      time_ms: a.time_ms as number,
    }
  })

  return {
    attempt_id: attempt.id,
    quiz_id: attempt.quiz_id,
    quiz_title: resolveTitle(attempt.quizzes),
    completed_at: attempt.completed_at,
    correct_answers: attempt.correct_answers,
    total_questions: attempt.total_questions,
    total_time_ms: attempt.total_time_ms,
    rank: rank?.rank ?? null,
    total_players: rank?.total_players ?? null,
    answers: mappedAnswers,
  }
}
