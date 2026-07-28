// READ-ONLY kartlegging av timeout-bug-omfang (submit/route.ts linje ~58).
// Ingen skriving til DB. Kjøres: node scripts/analyze-timeout-gap-scope.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function fetchAll(table, cols, build = q => q) {
  const out = []
  const pageSize = 1000
  let from = 0
  for (;;) {
    let q = sb.from(table).select(cols).order('id', { ascending: true }).range(from, from + pageSize - 1)
    q = build(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

// ── calculateStreak, speiler lib/ranking.ts uendret ─────────────────────────
function calculateStreak(answers) {
  let maxStreak = 0, cur = 0
  for (const a of answers) {
    if (a.is_correct) { cur++; maxStreak = Math.max(maxStreak, cur) } else { cur = 0 }
  }
  return maxStreak
}

console.log('Henter data...')
const [questions, attempts, answers, quizzes] = await Promise.all([
  fetchAll('questions', 'id, quiz_id, order_index'),
  fetchAll('attempts', 'id, quiz_id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, submitted_at', q => q.not('submitted_at', 'is', null)),
  fetchAll('attempt_answers', 'attempt_id, question_id, is_correct'),
  fetchAll('quizzes', 'id, title, closes_at, season_points_awarded'),
])
console.log(`  questions: ${questions.length}, submitted attempts: ${attempts.length}, attempt_answers: ${answers.length}, quizzes: ${quizzes.length}`)

const quizTitleById = new Map(quizzes.map(q => [q.id, q.title]))
const quizClosesAtById = new Map(quizzes.map(q => [q.id, q.closes_at]))

const questionsByQuiz = new Map()
for (const q of questions) {
  if (!questionsByQuiz.has(q.quiz_id)) questionsByQuiz.set(q.quiz_id, [])
  questionsByQuiz.get(q.quiz_id).push(q)
}
for (const [, arr] of questionsByQuiz) arr.sort((a, b) => a.order_index - b.order_index)

const answersByAttempt = new Map()
for (const a of answers) {
  if (!answersByAttempt.has(a.attempt_id)) answersByAttempt.set(a.attempt_id, [])
  answersByAttempt.get(a.attempt_id).push(a)
}

// ── 1. Berørte forsøk: attempt_answers-rader < total_questions ──────────────
const affected = []
for (const at of attempts) {
  const rows = answersByAttempt.get(at.id) ?? []
  if (rows.length < at.total_questions) {
    affected.push({ attempt: at, rows })
  }
}

console.log('\n════════════════════════════════════════════════════════════')
console.log('1) BERØRTE FORSØK (submitted, attempt_answers-rader < total_questions)')
console.log('════════════════════════════════════════════════════════════')
console.log(`Totalt berørte forsøk: ${affected.length} av ${attempts.length} innsendte forsøk`)
const affectedQuizIds = new Set(affected.map(a => a.attempt.quiz_id))
console.log(`Totalt berørte quizer: ${affectedQuizIds.size} av ${quizzes.length} quizer`)

const byQuiz = new Map()
for (const a of affected) {
  const qid = a.attempt.quiz_id
  if (!byQuiz.has(qid)) byQuiz.set(qid, [])
  byQuiz.get(qid).push(a)
}
console.log('\nFordelt per quiz:')
for (const [qid, list] of [...byQuiz.entries()].sort((a, b) => (quizClosesAtById.get(a[0]) || '').localeCompare(quizClosesAtById.get(b[0]) || ''))) {
  const title = quizTitleById.get(qid) ?? '(ukjent quiz)'
  const closes = quizClosesAtById.get(qid)
  console.log(`  - ${title}  (${qid.slice(0, 8)}…, stengt ${closes})  →  ${list.length} berørte spillere`)
}

// ── 2. Streak: faktisk vs. lagret ────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════')
console.log('2) STREAK: LAGRET vs. KORRIGERT (manglende spørsmål = feil)')
console.log('════════════════════════════════════════════════════════════')

let unreconstructable = 0
const streakDiffers = []
for (const { attempt: at, rows } of affected) {
  const quizQ = questionsByQuiz.get(at.quiz_id) ?? []
  if (quizQ.length !== at.total_questions) {
    // Quizens spørsmålssett har endret seg siden dette forsøket ble spilt —
    // kan ikke trygt rekonstruere nøyaktig rekkefølge. Rapporteres separat.
    unreconstructable++
    continue
  }
  const isCorrectByQid = new Map(rows.map(r => [r.question_id, r.is_correct]))
  const fullSeq = quizQ.map(q => ({ is_correct: isCorrectByQid.has(q.id) ? isCorrectByQid.get(q.id) : false }))
  const correctedStreak = calculateStreak(fullSeq)
  const storedStreak = at.correct_streak ?? 0
  if (correctedStreak !== storedStreak) {
    streakDiffers.push({ at, correctedStreak, storedStreak })
  }
}

console.log(`Kunne ikke trygt rekonstrueres (quizens spørsmålssett endret siden): ${unreconstructable}`)
console.log(`Forsøk der korrigert streak ≠ lagret streak: ${streakDiffers.length} av ${affected.length - unreconstructable} rekonstruerbare berørte forsøk`)
for (const { at, correctedStreak, storedStreak } of streakDiffers) {
  const title = quizTitleById.get(at.quiz_id) ?? '(ukjent)'
  console.log(`  - ${at.player_name}  (${title.slice(0, 30)})  lagret=${storedStreak} → korrigert=${correctedStreak}  [is_team=${at.is_team}, user_id=${at.user_id ? 'innlogget' : 'gjest'}]`)
}

// ── 3. Season_scores-konsekvens ──────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════')
console.log('3) KONSEKVENS FOR season_scores (global/liga/org)')
console.log('════════════════════════════════════════════════════════════')
console.log(`
Kodeanalyse (lib/season-points.ts, rankSeasonAttempts, linje 52-70):
rangeringen sorterer på correct_answers DESC, total_time_ms ASC, og BRUKER
correct_streak KUN som sorteringsnøkkel innad i en allerede lik gruppe — men
selve plasserings-TALLET (rank) tildeles utelukkende basert på om
(correct_answers, total_time_ms) er identisk med forrige rad. Streak inngår
IKKE i denne likhets-sjekken. Konsekvens: to spillere med ulik streak men
identisk (correct_answers, total_time_ms) får samme season_scores-rank
UANSETT streak-verdi — streak kan aldri endre et season_scores-rank-tall i
denne implementasjonen.

I tillegg: attempts har en unik DB-partial-index på (user_id, quiz_id) for
innloggede (migrasjon 20260620000000) — maks ÉN rad per bruker per quiz. Det
finnes derfor aldri to konkurrerende forsøk for samme bruker der
pickBestSeasonAttempt sin streak-tiebreak (linje 29-33) kunne slått ut
forskjellig.
`)

let seasonRankSanityMismatches = 0
if (byQuiz.size > 0) {
  const { data: seasonRows } = await sb
    .from('season_scores')
    .select('user_id, quiz_id, scope_type, scope_id, points, rank')
    .in('quiz_id', [...byQuiz.keys()])
  const seasonByQuiz = new Map()
  for (const r of seasonRows ?? []) {
    if (!seasonByQuiz.has(r.quiz_id)) seasonByQuiz.set(r.quiz_id, [])
    seasonByQuiz.get(r.quiz_id).push(r)
  }
  // Sanity-sjekk: bekreft empirisk at rank-grupperingen i season_scores for de
  // berørte quizene faktisk kun avhenger av (correct_answers, total_time_ms),
  // ikke streak — dvs. at KORRIGERT streak (som er identisk med lagret streak
  // for alle UBERØRTE forsøk, og kun avviker for de over) ikke kunne endret
  // grupperingen. Siden season_scores-rank er bevist streak-uavhengig over,
  // er dette kun en dobbeltsjekk mot faktiske prod-data.
  for (const [qid, rows] of seasonByQuiz) {
    const byUser = new Map(attempts.filter(a => a.quiz_id === qid && !a.is_team && a.user_id).map(a => [a.user_id, a]))
    for (const scopeType of new Set(rows.map(r => r.scope_type))) {
      const scopeRows = rows.filter(r => r.scope_type === scopeType)
      const scopeIds = new Set(scopeRows.map(r => r.scope_id))
      for (const scopeId of scopeIds) {
        const group = scopeRows.filter(r => r.scope_id === scopeId)
        // grupper på (correct_answers, total_time_ms) fra faktiske attempts
        const rankByPair = new Map()
        for (const g of group) {
          const at = byUser.get(g.user_id)
          if (!at) continue
          const key = `${at.correct_answers}|${at.total_time_ms}`
          if (!rankByPair.has(key)) rankByPair.set(key, g.rank)
          else if (rankByPair.get(key) !== g.rank) seasonRankSanityMismatches++
        }
      }
    }
  }
}
console.log(`Empirisk dobbeltsjekk: ${seasonRankSanityMismatches} tilfeller der to spillere med identisk (correct_answers, total_time_ms) fikk ULIK season_scores-rank innad i samme scope (ville indikert at streak likevel spilte inn). Forventet: 0.`)

console.log(`\n→ FAKTISKE season_scores-plasseringsendringer fra streak-korrigering: 0 (strukturelt umulig per kodeanalyse over)`)
console.log(`→ Topp-3-relevans for season_scores: 0 av 0 — ingen endringer å vurdere`)

// ── 4. Topp3/leaderboard-konsekvens (lib/ranking.ts rankQuizAttempts) ───────
console.log('\n════════════════════════════════════════════════════════════')
console.log('4) KONSEKVENS FOR QUIZ-NIVÅ TOPP3/LEADERBOARD (rankQuizAttempts)')
console.log('   (IKKE season_scores — dette er PER-QUIZ-resultatet vist rett')
console.log('    etter quizen, evt. delt på Facebook)')
console.log('════════════════════════════════════════════════════════════')

function compareAttempts(a, b) {
  if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
  if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
  const sd = (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  if (sd !== 0) return sd
  return a.id.localeCompare(b.id)
}
function rankQuizAttempts(list) {
  const bestByKey = new Map()
  for (const a of list) {
    const key = a.user_id ?? `name:${a.player_name}`
    const existing = bestByKey.get(key)
    if (!existing || compareAttempts(a, existing) < 0) bestByKey.set(key, a)
  }
  return [...bestByKey.values()].sort(compareAttempts).map((a, i) => ({ ...a, rank: i + 1 }))
}

let totalRankChanges = 0
let top3Changes = 0
const correctedStreakByAttemptId = new Map(streakDiffers.map(d => [d.at.id, d.correctedStreak]))

for (const [qid, list] of byQuiz) {
  for (const isTeamRoom of [false, true]) {
    const room = attempts.filter(a => a.quiz_id === qid && a.is_team === isTeamRoom)
    if (room.length === 0) continue
    const relevantDiffs = list.filter(a => a.attempt.is_team === isTeamRoom && correctedStreakByAttemptId.has(a.attempt.id))
    if (relevantDiffs.length === 0) continue // ingen faktisk streak-endring i dette rommet

    const current = rankQuizAttempts(room)
    const corrected = rankQuizAttempts(room.map(a =>
      correctedStreakByAttemptId.has(a.id) ? { ...a, correct_streak: correctedStreakByAttemptId.get(a.id) } : a
    ))
    const curRankById = new Map(current.map(r => [r.id, r.rank]))
    const corrRankById = new Map(corrected.map(r => [r.id, r.rank]))
    let changed = 0, top3 = 0
    for (const r of current) {
      const cr = corrRankById.get(r.id)
      if (cr !== r.rank) {
        changed++
        if (r.rank <= 3 || cr <= 3) top3++
        console.log(`  - Quiz "${(quizTitleById.get(qid) ?? '').slice(0, 30)}" [${isTeamRoom ? 'lag' : 'solo'}]  ${r.player_name}: rank ${r.rank} → ${cr}`)
      }
    }
    totalRankChanges += changed
    top3Changes += top3
  }
}
console.log(`\nTotalt antall faktiske quiz-nivå rank-endringer (Topp3/leaderboard): ${totalRankChanges}`)
console.log(`Hvorav i topp 3: ${top3Changes}`)

// ── 5. Oppsummering ──────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════')
console.log('OPPSUMMERING')
console.log('════════════════════════════════════════════════════════════')
console.log(`Berørte forsøk (manglende attempt_answers-rad): ${affected.length}`)
console.log(`Berørte quizer: ${affectedQuizIds.size}`)
console.log(`  - herav ikke rekonstruerbare (spørsmålssett endret siden): ${unreconstructable}`)
console.log(`Forsøk der streak faktisk ville vært annerledes: ${streakDiffers.length}`)
console.log(`season_scores-plasseringsendringer: 0 (strukturelt umulig, se punkt 3)`)
console.log(`  - herav i topp 3: 0`)
console.log(`Quiz-nivå Topp3/leaderboard-plasseringsendringer: ${totalRankChanges}`)
console.log(`  - herav i topp 3: ${top3Changes}`)
