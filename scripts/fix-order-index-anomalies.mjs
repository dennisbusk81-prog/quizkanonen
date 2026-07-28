// ─────────────────────────────────────────────────────────────────────────────
// DEL 3a — FIKSER order_index-anomalier på to quizer.
//
// Fredagsquiz 26.06.2026: to spørsmål deler order_index=2, ingen har 1.
//   → én av de to (laveste id) flyttes til order_index=1. Resten (3-15) uendret.
//   Rører IKKE de 13 allerede korrigerte streak-verdiene på denne quizen —
//   kun questions.order_index.
//
// Fredagsquiz 07.08.2026 (0 forsøk — ikke spilt ennå): seks spørsmål deler i
// dag order_index 14/14/14/15/15/15.
//   → renummereres deterministisk (sortert på id) til 14,15,16,17,18,19.
//
// KJØRING:
//   node scripts/fix-order-index-anomalies.mjs           → DRY RUN
//   node scripts/fix-order-index-anomalies.mjs --apply   → skriver
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

console.log(APPLY
  ? '*** APPLY-MODUS — DETTE OPPDATERER questions.order_index ***\n'
  : '=== DRY RUN — ingen skriving. Bruk --apply for a utfore. ===\n')

const [quizzes, questions, attempts] = await Promise.all([
  fetchAll('quizzes', 'id, title'),
  fetchAll('questions', 'id, quiz_id, order_index'),
  fetchAll('attempts', 'id, quiz_id, submitted_at'),
])

const qByQuiz = new Map()
for (const q of questions) { if (!qByQuiz.has(q.quiz_id)) qByQuiz.set(q.quiz_id, []); qByQuiz.get(q.quiz_id).push(q) }

const updates = [] // { id, from, to, quizTitle }

function planQuiz(titleMatch, expectedTotal) {
  const quiz = quizzes.find(q => q.title.includes(titleMatch))
  const qs = (qByQuiz.get(quiz.id) ?? []).sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id))
  console.log(`${quiz.title}: ${qs.length} sporsmal, order_index i dag = [${qs.map(q => q.order_index).join(',')}]`)

  const submittedCount = attempts.filter(a => a.quiz_id === quiz.id && a.submitted_at).length
  console.log(`   innsendte forsok: ${submittedCount}`)

  // Grupper per order_index-verdi
  const byIndex = new Map()
  for (const q of qs) { if (!byIndex.has(q.order_index)) byIndex.set(q.order_index, []); byIndex.get(q.order_index).push(q) }

  // Bygg ønsket rekkefolge: gå gjennom sorterte order_index-verdier, tildel
  // fortløpende nye verdier 1..N i samme relative rekkefolge (id-sortert innad
  // i tie-grupper), slik at ingen spørsmål bytter plass seg imellom utover å
  // fylle det manglende hullet / skille de sammenslåtte verdiene.
  let next = 1
  for (const [oldIdx, group] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    for (const q of group) {
      if (q.order_index !== next) updates.push({ id: q.id, from: q.order_index, to: next, quizTitle: quiz.title })
      next++
    }
  }
  console.log(`   -> ${updates.filter(u => u.quizTitle === quiz.title).length} rader far ny order_index\n`)
  return quiz
}

planQuiz('26.06', 15)
planQuiz('07.08', 19)

console.log('== Planlagte endringer ==')
for (const u of updates) console.log(`   ${u.quizTitle}: order_index ${u.from} → ${u.to}  (id=${u.id.slice(0, 8)}...)`)

// ── Verifiser at IKKE noe annet quiz i databasen har en anomali ────────────
console.log('\n== Isolasjonssjekk: alle 13 quizer ==')
let otherAnomalies = 0
for (const quiz of quizzes) {
  if (quiz.title.includes('26.06') || quiz.title.includes('07.08')) continue
  const qs = (qByQuiz.get(quiz.id) ?? [])
  if (qs.length === 0) continue
  const idx = qs.map(q => q.order_index).sort((a, b) => a - b)
  const distinct = new Set(idx)
  const clean = distinct.size === idx.length && Math.min(...idx) === 1 && Math.max(...idx) === distinct.size
  if (!clean) { otherAnomalies++; console.log(`   ⚠ ${quiz.title}: [${idx.join(',')}]`) }
}
console.log(otherAnomalies === 0
  ? '   ✓ Ingen andre quizer har order_index-anomalier.'
  : `   ⚠ ${otherAnomalies} andre quiz(er) har ogsa anomalier — se over.`)

if (!APPLY) {
  console.log('\n=== DRY RUN FERDIG — ingenting ble skrevet. ===')
  process.exit(0)
}

console.log('\n== SKRIVER TIL DATABASEN ==')
let done = 0
for (const u of updates) {
  const { error } = await sb.from('questions').update({ order_index: u.to }).eq('id', u.id)
  if (error) { console.error(`   FEILET for ${u.id}:`, error.message); process.exit(1) }
  done++
}
console.log(`   ${done} rader oppdatert`)

// Etterkontroll
const [afterQuestions] = await Promise.all([fetchAll('questions', 'id, quiz_id, order_index')])
const afterByQuiz = new Map()
for (const q of afterQuestions) { if (!afterByQuiz.has(q.quiz_id)) afterByQuiz.set(q.quiz_id, []); afterByQuiz.get(q.quiz_id).push(q) }
for (const titleMatch of ['26.06', '07.08']) {
  const quiz = quizzes.find(q => q.title.includes(titleMatch))
  const idx = (afterByQuiz.get(quiz.id) ?? []).map(q => q.order_index).sort((a, b) => a - b)
  console.log(`\n${quiz.title} etter fiks: [${idx.join(',')}]`)
  console.log(new Set(idx).size === idx.length && idx[0] === 1 && idx[idx.length - 1] === idx.length
    ? '   ✓ Unike, sammenhengende verdier 1..N' : '   ⚠ FORTSATT ANOMALI')
}
