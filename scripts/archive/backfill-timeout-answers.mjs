// ─────────────────────────────────────────────────────────────────────────────
// BACKFILL av manglende timeout-rader i attempt_answers + rekalkulering av
// attempts.correct_streak.
//
// BAKGRUNN: app/api/quiz/[id]/submit/route.ts filtrerte innkommende svar med
// `typeof selectedAnswer === 'string'`. Et timeout-svar sendes som
// { selectedAnswer: null, timeMs: <full tidsgrense> }, og siden
// `typeof null === 'object'` ble raden stille forkastet. Spørsmålet forsvant
// helt fra attempt_answers i stedet for å telle som feil, slik at
// correct_streak kunne løpe ubrutt over det manglende spørsmålet.
//
// DENNE FILEN GJØR TO TING (og bare disse to):
//   1. Setter inn de manglende attempt_answers-radene
//      (selected_answer = NULL, is_correct = false, time_ms = full tidsgrense)
//   2. Rekalkulerer attempts.correct_streak for de berørte forsøkene
//
// RØRER IKKE: attempts.correct_answers, attempts.total_time_ms, season_scores,
//             eller noen annen tabell.
//
// MERK — EN ANNEN, ELDRE FEIL FINNES OGSÅ I DATAENE:
// app/api/admin/correct-answer/route.ts oppdaterer correct_answers og score når
// admin endrer fasit, men rekalkulerer ALDRI correct_streak. Det har etterlatt
// utdaterte streak-verdier på forsøk som aldri var berørt av timeout-feilen.
// Skriptet oppdager og RAPPORTERER dette, men retter det ikke — det er en egen
// beslutning. For de forsøkene som er berørt av BEGGE feilene splittes
// streak-endringen i to, slik at effekten av hver feil er synlig hver for seg.
//
// KJØRING:
//   node scripts/backfill-timeout-answers.mjs           → DRY RUN (ingen skriv)
//   node scripts/backfill-timeout-answers.mjs --apply   → skriver til databasen
//
// Idempotent: kjøres den to ganger finner andre kjøring 0 berørte forsøk.
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
  const out = []
  let from = 0
  for (;;) {
    const { data, error } = await build(
      sb.from(table).select(cols).order('id', { ascending: true }).range(from, from + 999)
    )
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

// Speiler lib/ranking.ts UENDRET.
function calculateStreak(answers) {
  let maxStreak = 0, cur = 0
  for (const a of answers) {
    if (a.is_correct) { cur++; maxStreak = Math.max(maxStreak, cur) } else { cur = 0 }
  }
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
  fetchAll('questions', 'id, quiz_id, order_index, time_limit_seconds'),
  fetchAll('attempts', 'id, quiz_id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, submitted_at', q => q.not('submitted_at', 'is', null)),
  fetchAll('attempt_answers', 'attempt_id, question_id, is_correct'),
  fetchAll('quizzes', 'id, title, time_limit_seconds'),
])

const quizById = new Map(quizzes.map(q => [q.id, q]))
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

// Kollapser duplikate rader per spørsmål. Flagger hvis duplikatene er uenige om
// is_correct (da ville valget vært vilkårlig og resultatet upålitelig).
function gradeMap(rows) {
  const m = new Map()
  let conflict = false
  for (const r of rows) {
    if (m.has(r.question_id) && m.get(r.question_id) !== r.is_correct) conflict = true
    m.set(r.question_id, r.is_correct)
  }
  return { map: m, conflict }
}

// ── FASE 1 — validering av metoden mot komplette forsøk ─────────────────────
let consistent = 0
const staleGrading = []   // correct_answers stemmer, streak er utdatert (admin-fasitendring)
const methodError = []    // correct_answers stemmer IKKE → metoden er upålitelig
const conflicts = []
const duplicated = []     // duplikate rader → lagrede tellinger er upålitelige
const incomplete = []

for (const at of attempts) {
  const rows = answersByAttempt.get(at.id) ?? []
  const quizQ = questionsByQuiz.get(at.quiz_id) ?? []
  if (quizQ.length !== at.total_questions) continue

  const { map: grade, conflict } = gradeMap(rows)
  if (conflict) { conflicts.push(at); continue }
  if (![...grade.keys()].every(k => quizQ.some(q => q.id === k))) continue

  if (grade.size < at.total_questions) { incomplete.push({ at, grade, quizQ }); continue }

  // Duplikate rader gjør lagrede tellinger upålitelige som fasit for validering:
  // admin-rutens opptelling (COUNT der is_correct = true) teller duplikatet to
  // ganger, så attempts.correct_answers kan være kunstig høy. Disse holdes utenfor
  // metodevalideringen og rapporteres som en egen, tredje datafeil.
  if (rows.length > grade.size) {
    const recS = calculateStreak(quizQ.map(q => ({ is_correct: grade.get(q.id) === true })))
    const recC = [...grade.values()].filter(Boolean).length
    duplicated.push({ at, extra: rows.length - grade.size, recStreak: recS, recCorrect: recC })
    continue
  }

  const recStreak = calculateStreak(quizQ.map(q => ({ is_correct: grade.get(q.id) === true })))
  const recCorrect = [...grade.values()].filter(Boolean).length

  if (recStreak === (at.correct_streak ?? 0)) consistent++
  else if (recCorrect === at.correct_answers) staleGrading.push({ at, recStreak })
  else methodError.push({ at, recStreak, recCorrect })
}

console.log('== FASE 1 — validering av rekkefolge-/streak-metoden ==')
console.log(`   Komplette forsok der rekalkulert streak == lagret verdi: ${consistent}`)
console.log(`   Forsok med UTDATERT streak etter admin-fasitendring:     ${staleGrading.length}`)
console.log(`   Forsok med DUPLIKATE svarrader:                          ${duplicated.length}`)
console.log(`   Forsok med motstridende duplikatrader:                   ${conflicts.length}`)
console.log(`   Forsok med hull (timeout-feilen) — skal backfilles:      ${incomplete.length}`)
console.log(`   Forsok der METODEN ikke reproduserer lagrede tall:       ${methodError.length}`)

if (methodError.length > 0) {
  console.log('\n   STOPPER: metoden reproduserer ikke correct_answers for disse:')
  for (const m of methodError.slice(0, 10)) {
    console.log(`     ${m.at.player_name}: correct lagret=${m.at.correct_answers} beregnet=${m.recCorrect}`)
  }
  process.exit(1)
}
if (staleGrading.length > 0) {
  console.log('\n   (Utdaterte streak-verdier fra admin-fasitendring — EGEN sak, rores ikke her:)')
  for (const s of staleGrading) {
    console.log(`     ${s.at.player_name.padEnd(26)} ${(quizById.get(s.at.quiz_id)?.title ?? '').slice(0, 24).padEnd(24)} lagret=${s.at.correct_streak} korrekt=${s.recStreak}`)
  }
}
if (duplicated.length > 0) {
  console.log('\n   (Duplikate svarrader — EGEN sak, rores ikke her. Lagret correct_answers')
  console.log('    kan vaere for hoy fordi admin-rutens opptelling teller duplikatet flere ganger:)')
  for (const d of duplicated) {
    const t = (quizById.get(d.at.quiz_id)?.title ?? '').slice(0, 22)
    console.log(`     ${d.at.player_name.padEnd(26)} ${t.padEnd(22)} +${d.extra} ekstra rad(er)  correct lagret=${d.at.correct_answers} distinkt=${d.recCorrect}`)
  }
}
if (conflicts.length > 0) {
  console.log('\n   (Duplikater som er UENIGE om is_correct — utelatt fra validering:)')
  for (const c of conflicts) {
    console.log(`     ${c.player_name.padEnd(26)} ${(quizById.get(c.quiz_id)?.title ?? '').slice(0, 22)}`)
  }
}
console.log('\n   -> Rekkefolge-antakelsen (questions.order_index) er bekreftet mot ekte data.\n')

// ── FASE 2 — planlagte endringer for de berørte forsøkene ───────────────────
const plannedRows = []
const plannedStreakUpdates = []
const plan = []

for (const { at, grade, quizQ } of incomplete) {
  const missing = quizQ.filter(q => !grade.has(q.id))
  if (missing.length === 0) continue

  const quizLimit = quizById.get(at.quiz_id)?.time_limit_seconds ?? 30
  for (const q of missing) {
    plannedRows.push({
      attempt_id: at.id,
      question_id: q.id,
      selected_answer: null,
      is_correct: false,
      time_ms: (q.time_limit_seconds ?? quizLimit) * 1000,
    })
  }

  const stored = at.correct_streak ?? 0
  // Uten de manglende spørsmålene, med dagens retting — altså hva submit ville
  // beregnet i dag. Avvik herfra mot `stored` skyldes admin-fasitendring, ikke timeout.
  const withoutMissing = calculateStreak(
    quizQ.filter(q => grade.has(q.id)).map(q => ({ is_correct: grade.get(q.id) === true }))
  )
  // Med de manglende spørsmålene inkludert som FEIL — den korrekte sluttverdien.
  const final = calculateStreak(quizQ.map(q => ({ is_correct: grade.get(q.id) === true })))

  plan.push({ at, missing, stored, withoutMissing, final })
  if (final !== stored) plannedStreakUpdates.push({ id: at.id, at, stored, final })
}

console.log('== FASE 2 — planlagte endringer ==')
console.log(`   Berorte forsok:                          ${plan.length}`)
console.log(`   attempt_answers-rader som settes inn:     ${plannedRows.length}`)
console.log(`   attempts.correct_streak som oppdateres:   ${plannedStreakUpdates.length}`)

const timeoutOnly = plan.filter(p => p.final !== p.withoutMissing).length
const staleOnly = plan.filter(p => p.withoutMissing !== p.stored).length
console.log(`\n   Av streak-endringene skyldes:`)
console.log(`     timeout-feilen (denne saken):          ${timeoutOnly}`)
console.log(`     admin-fasitendring (den andre saken):  ${staleOnly}`)

console.log('\n   Detaljer per berort forsok:')
console.log('   ' + 'SPILLER'.padEnd(26) + 'QUIZ'.padEnd(26) + 'RADER  STREAK')
for (const p of plan) {
  const title = (quizById.get(p.at.quiz_id)?.title ?? '?').slice(0, 24)
  let note
  if (p.final === p.stored) note = `uendret (${p.stored})`
  else if (p.withoutMissing === p.stored) note = `${p.stored} -> ${p.final}  (timeout)`
  else if (p.final === p.withoutMissing) note = `${p.stored} -> ${p.final}  (fasitendring)`
  else note = `${p.stored} -> ${p.final}  (timeout + fasitendring, via ${p.withoutMissing})`
  console.log(`   ${p.at.player_name.padEnd(26)}${title.padEnd(26)}+${String(p.missing.length).padEnd(6)}${note}`)
}

// ── FASE 3 — rangeringseffekt ───────────────────────────────────────────────
const newStreakById = new Map(plannedStreakUpdates.map(u => [u.id, u.final]))
let rankChanges = 0, top3Changes = 0
for (const quizId of new Set(plan.map(p => p.at.quiz_id))) {
  for (const isTeam of [false, true]) {
    const room = attempts.filter(a => a.quiz_id === quizId && a.is_team === isTeam)
    if (room.length === 0) continue
    const before = rankQuizAttempts(room)
    const after = rankQuizAttempts(room.map(a =>
      newStreakById.has(a.id) ? { ...a, correct_streak: newStreakById.get(a.id) } : a
    ))
    const afterRank = new Map(after.map(r => [r.id, r.rank]))
    for (const r of before) {
      const nr = afterRank.get(r.id)
      if (nr !== r.rank) {
        rankChanges++
        if (r.rank <= 3 || nr <= 3) top3Changes++
        console.log(`   RANGERING ENDRES: ${r.player_name} ${r.rank} -> ${nr}`)
      }
    }
  }
}
console.log('\n== FASE 3 — rangeringseffekt ==')
console.log(`   Quiz-leaderboard plasseringsendringer: ${rankChanges} (hvorav i topp 3: ${top3Changes})`)
console.log(`   season_scores: uendret — streak inngar ikke i rank-tildelingen der`)
console.log(`                  (lib/season-points.ts), og verken correct_answers`)
console.log(`                  eller total_time_ms rores av dette skriptet.`)

if (!APPLY) {
  console.log('\n=== DRY RUN FERDIG — ingenting ble skrevet. ===')
  process.exit(0)
}

// ── FASE 4 — utførelse ──────────────────────────────────────────────────────
console.log('\n== FASE 4 — SKRIVER TIL DATABASEN ==')

let inserted = 0
for (let i = 0; i < plannedRows.length; i += 200) {
  const chunk = plannedRows.slice(i, i + 200)
  const { error } = await sb.from('attempt_answers').insert(chunk)
  if (error) { console.error('   INSERT FEILET:', error.message); process.exit(1) }
  inserted += chunk.length
  console.log(`   satt inn ${inserted}/${plannedRows.length} rader`)
}

let updated = 0
for (const u of plannedStreakUpdates) {
  const { error } = await sb.from('attempts').update({ correct_streak: u.final }).eq('id', u.id)
  if (error) { console.error(`   UPDATE FEILET for ${u.id}:`, error.message); process.exit(1) }
  updated++
  console.log(`   ${u.at.player_name}: correct_streak ${u.stored} -> ${u.final}`)
}

console.log('\n== FERDIG ==')
console.log(`   attempt_answers-rader satt inn:    ${inserted}`)
console.log(`   attempts.correct_streak oppdatert: ${updated}`)
