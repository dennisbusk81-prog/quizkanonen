// ─────────────────────────────────────────────────────────────────────────────
// BACKFILL av utdaterte attempts.correct_streak etter admin-fasitendringer.
//
// BAKGRUNN: app/api/admin/correct-answer/route.ts oppdaterte attempt_answers
// .is_correct og attempts.correct_answers/score når admin rettet en fasit, men
// rekalkulerte ALDRI attempts.correct_streak. Streak-verdien ble derfor stående
// slik den var da forsøket opprinnelig ble levert, mens karaktergrunnlaget under
// var endret. Ruten er rettet; dette skriptet retter de historiske radene.
//
// GJØR KUN ÉN TING: setter attempts.correct_streak til verdien beregnet fra
// dagens attempt_answers, i questions.order_index-rekkefølge.
//
// RØRER IKKE: correct_answers, score, total_time_ms, attempt_answers,
//             season_scores, eller noen annen tabell/kolonne.
//
// SIKKERHETSVAKTER (skriptet stopper hvis noen av dem slår ut):
//   - Forsøk med hull i svarrekken (færre distinkte svar enn total_questions)
//     hoppes over — de hører til timeout-saken, ikke denne.
//   - Forsøk med duplikate svarrader hoppes over — der er lagrede tellinger
//     upålitelige, og streak kan ikke utledes entydig.
//   - Hvis rekalkulert correct_answers IKKE stemmer med lagret verdi, stopper
//     skriptet: da er forutsetningen (kun streak er utdatert) brutt.
//
// KJØRING:
//   node scripts/backfill-stale-streaks.mjs           → DRY RUN (ingen skriv)
//   node scripts/backfill-stale-streaks.mjs --apply   → skriver til databasen
//
// Idempotent: andre kjøring finner 0 forsøk å rette.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')

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

// Speiler lib/ranking.ts UENDRET.
function calculateStreak(answers) {
  let maxStreak = 0, cur = 0
  for (const a of answers) { if (a.is_correct) { cur++; maxStreak = Math.max(maxStreak, cur) } else cur = 0 }
  return maxStreak
}
function compareAttempts(a, b) {
  if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
  if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
  const sd = (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  if (sd !== 0) return sd
  return a.id.localeCompare(b.id)
}
function rankQuizAttempts(list) {
  const best = new Map()
  for (const a of list) {
    if (a.submitted_at == null) continue
    const key = a.user_id ?? `name:${a.player_name}`
    const cur = best.get(key)
    if (!cur || compareAttempts(a, cur) < 0) best.set(key, a)
  }
  return [...best.values()].sort(compareAttempts).map((a, i) => ({ ...a, rank: i + 1 }))
}

console.log(APPLY
  ? '*** APPLY-MODUS — DETTE SKRIVER TIL DATABASEN ***\n'
  : '=== DRY RUN — ingen skriving. Bruk --apply for a utfore. ===\n')

const [questions, attempts, answers, quizzes] = await Promise.all([
  fetchAll('questions', 'id, quiz_id, order_index'),
  fetchAll('attempts', 'id, quiz_id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, submitted_at', q => q.not('submitted_at', 'is', null)),
  fetchAll('attempt_answers', 'attempt_id, question_id, is_correct'),
  fetchAll('quizzes', 'id, title'),
])

const titleById = new Map(quizzes.map(q => [q.id, q.title]))
const qByQuiz = new Map()
for (const q of questions) { if (!qByQuiz.has(q.quiz_id)) qByQuiz.set(q.quiz_id, []); qByQuiz.get(q.quiz_id).push(q) }
for (const [, a] of qByQuiz) a.sort((x, y) => x.order_index - y.order_index)
const byAttempt = new Map()
for (const a of answers) { if (!byAttempt.has(a.attempt_id)) byAttempt.set(a.attempt_id, []); byAttempt.get(a.attempt_id).push(a) }

const planned = []
const skippedGaps = []
const skippedDupes = []
const blocked = []

for (const at of attempts) {
  const rows = byAttempt.get(at.id) ?? []
  const quizQ = qByQuiz.get(at.quiz_id) ?? []
  if (quizQ.length !== at.total_questions) continue

  const grade = new Map()
  let conflict = false
  for (const r of rows) {
    if (grade.has(r.question_id) && grade.get(r.question_id) !== r.is_correct) conflict = true
    grade.set(r.question_id, r.is_correct)
  }
  if (![...grade.keys()].every(k => quizQ.some(q => q.id === k))) continue

  if (grade.size < at.total_questions) { skippedGaps.push(at); continue }
  if (rows.length > grade.size || conflict) { skippedDupes.push(at); continue }

  const recStreak = calculateStreak(quizQ.map(q => ({ is_correct: grade.get(q.id) === true })))
  if (recStreak === (at.correct_streak ?? 0)) continue

  const recCorrect = [...grade.values()].filter(Boolean).length
  if (recCorrect !== at.correct_answers) { blocked.push({ at, recCorrect, recStreak }); continue }

  planned.push({ at, recStreak })
}

console.log('== FASE 1 — kandidater ==')
console.log(`   Forsok med utdatert streak som skal rettes: ${planned.length}`)
console.log(`   Hoppet over (hull i svarrekken):            ${skippedGaps.length}`)
console.log(`   Hoppet over (duplikate svarrader):          ${skippedDupes.length}`)
console.log(`   BLOKKERT (correct_answers stemmer ikke):    ${blocked.length}`)

if (blocked.length > 0) {
  console.log('\n   STOPPER — forutsetningen om at KUN streak er utdatert holder ikke:')
  for (const b of blocked) {
    console.log(`     ${b.at.player_name}: correct lagret=${b.at.correct_answers} beregnet=${b.recCorrect}`)
  }
  process.exit(1)
}

if (planned.length === 0) {
  console.log('\n   Ingenting a rette.')
  process.exit(0)
}

console.log('\n   Detaljer:')
console.log('   ' + 'SPILLER'.padEnd(28) + 'QUIZ'.padEnd(26) + 'STREAK')
for (const p of planned) {
  const dir = p.recStreak > (p.at.correct_streak ?? 0) ? 'opp' : 'ned'
  console.log(`   ${p.at.player_name.padEnd(28)}${(titleById.get(p.at.quiz_id) ?? '').slice(0, 24).padEnd(26)}${p.at.correct_streak} -> ${p.recStreak}  (${dir})`)
}

// ── FASE 2 — rangeringseffekt ───────────────────────────────────────────────
const newById = new Map(planned.map(p => [p.at.id, p.recStreak]))
let rankChanges = 0, top3 = 0
for (const quizId of new Set(planned.map(p => p.at.quiz_id))) {
  for (const isTeam of [false, true]) {
    const room = attempts.filter(a => a.quiz_id === quizId && a.is_team === isTeam)
    if (room.length === 0) continue
    const before = rankQuizAttempts(room)
    const after = rankQuizAttempts(room.map(a => newById.has(a.id) ? { ...a, correct_streak: newById.get(a.id) } : a))
    const ar = new Map(after.map(r => [r.id, r.rank]))
    for (const r of before) {
      if (ar.get(r.id) !== r.rank) {
        rankChanges++
        if (r.rank <= 3 || ar.get(r.id) <= 3) top3++
        console.log(`   RANGERING ENDRES: ${r.player_name} ${r.rank} -> ${ar.get(r.id)}`)
      }
    }
  }
}
console.log('\n== FASE 2 — rangeringseffekt ==')
console.log(`   Quiz-leaderboard plasseringsendringer: ${rankChanges} (hvorav i topp 3: ${top3})`)
console.log(`   season_scores: uendret — streak inngar ikke i rank-tildelingen der.`)

if (!APPLY) {
  console.log('\n=== DRY RUN FERDIG — ingenting ble skrevet. ===')
  process.exit(0)
}

console.log('\n== FASE 3 — SKRIVER TIL DATABASEN ==')
let updated = 0
for (const p of planned) {
  const { error } = await sb.from('attempts').update({ correct_streak: p.recStreak }).eq('id', p.at.id)
  if (error) { console.error(`   UPDATE FEILET for ${p.at.id}:`, error.message); process.exit(1) }
  updated++
  console.log(`   ${p.at.player_name}: correct_streak ${p.at.correct_streak} -> ${p.recStreak}`)
}
console.log(`\n== FERDIG ==\n   attempts.correct_streak oppdatert: ${updated}`)
