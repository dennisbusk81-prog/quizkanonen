// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY kartlegging av duplikate attempt_answers-rader.
// Skriver ALDRI til databasen. node scripts/map-duplicate-answers.mjs
//
// Svarer pa tre sporsmal:
//   1. Er buggen fortsatt AKTIV, eller er alle tilfellene historiske rester?
//   2. Hva er rot-arsaken?
//   3. Har duplikatene endret noens SYNLIGE poengsum eller plassering?
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function fetchAll(table, cols, build = q => q) {
  const out = []; let from = 0
  for (;;) {
    const { data, error } = await build(sb.from(table).select(cols).order('id', { ascending: true }).range(from, from + 999))
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data); if (data.length < 1000) break; from += 1000
  }
  return out
}

const [attempts, answers, quizzes, seasonRows] = await Promise.all([
  fetchAll('attempts', 'id, quiz_id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, submitted_at, completed_at'),
  fetchAll('attempt_answers', 'id, attempt_id, question_id, is_correct, selected_answer'),
  fetchAll('quizzes', 'id, title, closes_at'),
  fetchAll('season_scores', 'id, user_id, quiz_id, scope_type, scope_id, points, rank'),
])

const quizById = new Map(quizzes.map(q => [q.id, q]))
const attById = new Map(attempts.map(a => [a.id, a]))
const byAttempt = new Map()
for (const a of answers) {
  if (!byAttempt.has(a.attempt_id)) byAttempt.set(a.attempt_id, [])
  byAttempt.get(a.attempt_id).push(a)
}

// ── Finn alle forsok med duplikate (attempt_id, question_id) ────────────────
const dupes = []
for (const [attemptId, rows] of byAttempt) {
  const at = attById.get(attemptId)
  if (!at) continue
  const distinct = new Set(rows.map(r => r.question_id)).size
  if (rows.length === distinct) continue

  const perQ = new Map()
  for (const r of rows) perQ.set(r.question_id, (perQ.get(r.question_id) ?? 0) + 1)
  const maxCopies = Math.max(...perQ.values())
  const qWithDupes = [...perQ.values()].filter(n => n > 1).length

  // Er duplikatene uenige om is_correct?
  let conflict = false
  const grade = new Map()
  for (const r of rows) {
    if (grade.has(r.question_id) && grade.get(r.question_id) !== r.is_correct) conflict = true
    grade.set(r.question_id, r.is_correct)
  }

  dupes.push({
    at, rows: rows.length, distinct, extra: rows.length - distinct,
    maxCopies, qWithDupes, conflict, grade,
    wholeMultiple: qWithDupes === distinct && rows.length % distinct === 0,
  })
}

console.log('══════════════════════════════════════════════════════════════')
console.log('1) ER BUGGEN FORTSATT AKTIV?')
console.log('══════════════════════════════════════════════════════════════')
console.log(`Forsok med duplikate svarrader: ${dupes.length} av ${attempts.length} forsok totalt\n`)

const byQuiz = new Map()
for (const d of dupes) {
  if (!byQuiz.has(d.at.quiz_id)) byQuiz.set(d.at.quiz_id, [])
  byQuiz.get(d.at.quiz_id).push(d)
}

console.log('Fordelt per quiz (kronologisk etter naar quizen stengte):')
const allQuizzesSorted = [...quizzes].sort((a, b) => (a.closes_at ?? '').localeCompare(b.closes_at ?? ''))
for (const q of allQuizzesSorted) {
  const list = byQuiz.get(q.id) ?? []
  const totalForQuiz = attempts.filter(a => a.quiz_id === q.id).length
  if (totalForQuiz === 0) continue
  const flag = list.length > 0 ? `${String(list.length).padStart(2)} med duplikater` : ' 0 med duplikater'
  console.log(`  ${(q.closes_at ?? '').slice(0, 10)}  ${(q.title ?? '').slice(0, 26).padEnd(28)}${flag}   (${totalForQuiz} forsok)`)
}

// Nyeste forsok med duplikat, datert pa submitted_at
const dated = dupes
  .filter(d => d.at.submitted_at)
  .sort((a, b) => b.at.submitted_at.localeCompare(a.at.submitted_at))
console.log('\nNyeste forsok med duplikat (etter submitted_at):')
for (const d of dated.slice(0, 5)) {
  console.log(`  ${d.at.submitted_at.slice(0, 19).replace('T', ' ')}  ${d.at.player_name.padEnd(24)} +${d.extra} rader`)
}
const newest = dated[0]?.at.submitted_at ?? null
const lastSubmitted = attempts.filter(a => a.submitted_at).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0]?.submitted_at
console.log(`\n  Nyeste duplikat totalt:      ${newest?.slice(0, 10) ?? '(ingen)'}`)
console.log(`  Nyeste innsending i basen:   ${lastSubmitted?.slice(0, 10) ?? '(ingen)'}`)

// Innsendinger etter siste duplikat = "ren periode"
if (newest) {
  const after = attempts.filter(a => a.submitted_at && a.submitted_at > newest)
  console.log(`  Innsendinger ETTER nyeste duplikat, uten a lage nye duplikater: ${after.length}`)
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log('2) MONSTER I DUPLIKATENE (peker mot rot-arsak)')
console.log('══════════════════════════════════════════════════════════════')
console.log('  SPILLER                   QUIZ            RADER/DISTINKT  KOPIER  HELE-MULTIPPEL  UENIGE')
for (const d of dupes.sort((a, b) => b.extra - a.extra)) {
  const t = (quizById.get(d.at.quiz_id)?.title ?? '').replace('Fredagsquiz ', '').slice(0, 12)
  console.log(`  ${d.at.player_name.slice(0, 24).padEnd(26)}${t.padEnd(16)}${String(d.rows).padStart(3)}/${String(d.distinct).padEnd(4)}      ${String(d.maxCopies).padStart(2)}x      ${d.wholeMultiple ? 'JA ' : 'nei'}            ${d.conflict ? 'JA' : 'nei'}`)
}
const wholeCount = dupes.filter(d => d.wholeMultiple).length
console.log(`\n  Hele multipler (ALLE sporsmal duplisert like mange ganger): ${wholeCount} av ${dupes.length}`)
console.log('  -> et helt multippel betyr at HELE svarsettet ble satt inn paa nytt,')
console.log('     altsa at submit-ruten kjorte gjennom flere ganger for samme forsok.')

console.log('\n══════════════════════════════════════════════════════════════')
console.log('3) SYNLIG EFFEKT: poengsum og plassering')
console.log('══════════════════════════════════════════════════════════════')

// Lagret correct_answers vs. distinkt-basert
const inflated = []
for (const d of dupes) {
  const distinctCorrect = [...d.grade.values()].filter(Boolean).length
  if (distinctCorrect !== d.at.correct_answers) {
    inflated.push({ ...d, distinctCorrect })
  }
}
console.log(`Forsok der lagret correct_answers avviker fra distinkt telling: ${inflated.length}`)
for (const i of inflated) {
  console.log(`  ${i.at.player_name.padEnd(26)}${(quizById.get(i.at.quiz_id)?.title ?? '').slice(0, 24).padEnd(26)}lagret=${i.at.correct_answers} distinkt=${i.distinctCorrect}`)
}

// Rangering: dagens verdier vs. korrigerte verdier
function compareAttempts(a, b) {
  if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
  if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
  const sd = (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  if (sd !== 0) return sd
  return a.id.localeCompare(b.id)
}
function rankQuiz(list) {
  const best = new Map()
  for (const a of list) {
    if (a.submitted_at == null) continue
    const key = a.user_id ?? `name:${a.player_name}`
    const cur = best.get(key)
    if (!cur || compareAttempts(a, cur) < 0) best.set(key, a)
  }
  return [...best.values()].sort(compareAttempts).map((a, i) => ({ ...a, rank: i + 1 }))
}
const fixById = new Map(inflated.map(i => [i.at.id, i.distinctCorrect]))

let lbChanges = 0, lbTop3 = 0
for (const quizId of new Set(attempts.map(a => a.quiz_id))) {
  for (const isTeam of [false, true]) {
    const room = attempts.filter(a => a.quiz_id === quizId && a.is_team === isTeam)
    if (room.length === 0) continue
    const before = rankQuiz(room)
    const after = rankQuiz(room.map(a => fixById.has(a.id) ? { ...a, correct_answers: fixById.get(a.id) } : a))
    const ar = new Map(after.map(r => [r.id, r.rank]))
    for (const r of before) {
      if (ar.get(r.id) !== r.rank) {
        lbChanges++
        const t3 = r.rank <= 3 || ar.get(r.id) <= 3
        if (t3) lbTop3++
        console.log(`  LEADERBOARD: ${(quizById.get(quizId)?.title ?? '').slice(0, 22).padEnd(24)} ${r.player_name.padEnd(24)} ${r.rank} -> ${ar.get(r.id)}${t3 ? '   << TOPP 3' : ''}`)
      }
    }
  }
}
console.log(`\nQuiz-leaderboard plasseringsendringer: ${lbChanges} (i topp 3: ${lbTop3})`)

// season_scores: speiler lib/season-points.ts rankSeasonAttempts
function rankSeason(bestByUser) {
  const sorted = [...bestByUser.entries()].sort(([, a], [, b]) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
    return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  })
  const res = []
  for (let i = 0; i < sorted.length; i++) {
    let rank = i + 1
    if (i > 0) {
      const [, prev] = sorted[i - 1]; const [, cur] = sorted[i]
      if (cur.correct_answers === prev.correct_answers && cur.total_time_ms === prev.total_time_ms) rank = res[i - 1].rank
    }
    res.push({ userId: sorted[i][0], rank })
  }
  return res
}
const POINTS = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]
const pts = r => (r <= 10 ? POINTS[r - 1] : 1)

let ssChanges = 0, ssTop3 = 0
for (const quizId of new Set(inflated.map(i => i.at.quiz_id))) {
  const pool = attempts.filter(a => a.quiz_id === quizId && !a.is_team && a.user_id)
  const mk = (fix) => {
    const m = new Map()
    for (const a of pool) {
      const v = fix && fixById.has(a.id) ? { ...a, correct_answers: fixById.get(a.id) } : a
      const cur = m.get(a.user_id)
      if (!cur || compareAttempts(v, cur) < 0) m.set(a.user_id, v)
    }
    return m
  }
  const before = new Map(rankSeason(mk(false)).map(r => [r.userId, r.rank]))
  const after = new Map(rankSeason(mk(true)).map(r => [r.userId, r.rank]))
  for (const [uid, rb] of before) {
    const ra = after.get(uid)
    if (ra !== rb) {
      ssChanges++
      const t3 = rb <= 3 || ra <= 3
      if (t3) ssTop3++
      const nm = pool.find(a => a.user_id === uid)?.player_name ?? uid
      console.log(`  SEASON: ${(quizById.get(quizId)?.title ?? '').slice(0, 22).padEnd(24)} ${nm.padEnd(24)} rank ${rb} -> ${ra}   poeng ${pts(rb)} -> ${pts(ra)}${t3 ? '   << TOPP 3' : ''}`)
    }
  }
}
console.log(`\nseason_scores rangeringsendringer: ${ssChanges} (i topp 3: ${ssTop3})`)

// Er de lagrede season_scores-radene i takt med dagens attempts?
let ssStale = 0
for (const quizId of new Set(inflated.map(i => i.at.quiz_id))) {
  const pool = attempts.filter(a => a.quiz_id === quizId && !a.is_team && a.user_id)
  const m = new Map()
  for (const a of pool) {
    const cur = m.get(a.user_id)
    if (!cur || compareAttempts(a, cur) < 0) m.set(a.user_id, a)
  }
  const computed = new Map(rankSeason(m).map(r => [r.userId, r.rank]))
  for (const r of seasonRows.filter(s => s.quiz_id === quizId && s.scope_type === 'global')) {
    if (computed.get(r.user_id) !== r.rank) ssStale++
  }
}
console.log(`Lagrede season_scores-rader (global) som IKKE stemmer med dagens attempts: ${ssStale}`)
