// Read-only: sjekker at ALLE quizer i prod har konsistent order_index —
// unike verdier, start på 1, sammenhengende 1..N. Skriver INGENTING.
// Kalles:  node scripts/verify-order-index-consistency.mjs
//
// Samme sjekk som «isolasjonssjekken» i fix-order-index-anomalies.mjs, men
// over alle quizer og uten noen skrivegren i det hele tatt.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function fetchAll(table, cols) {
  const out = []; let from = 0
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).order('id', { ascending: true }).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data); if (data.length < 1000) break; from += 1000
  }
  return out
}

const [quizzes, questions] = await Promise.all([
  fetchAll('quizzes', 'id, title, created_at'),
  fetchAll('questions', 'id, quiz_id, order_index'),
])

const qByQuiz = new Map()
for (const q of questions) {
  if (!qByQuiz.has(q.quiz_id)) qByQuiz.set(q.quiz_id, [])
  qByQuiz.get(q.quiz_id).push(q)
}

let anomalies = 0
console.log(`${quizzes.length} quizer, ${questions.length} spørsmål totalt\n`)
for (const quiz of quizzes) {
  const qs = qByQuiz.get(quiz.id) ?? []
  if (qs.length === 0) { console.log(`  (0 spørsmål)      ${quiz.title}`); continue }
  const idx = qs.map(q => q.order_index).sort((a, b) => a - b)
  const distinct = new Set(idx)
  const clean = distinct.size === idx.length && idx[0] === 1 && idx[idx.length - 1] === idx.length
  if (clean) {
    console.log(`  ✓ 1..${idx.length}  ${quiz.title}`)
  } else {
    anomalies++
    console.log(`  ⚠ ANOMALI [${idx.join(',')}]  ${quiz.title}  (id=${quiz.id})`)
  }
}
console.log(anomalies === 0
  ? '\n✓ Ingen quizer har inkonsistent order_index.'
  : `\n⚠ ${anomalies} quiz(er) har inkonsistent order_index — se over.`)
process.exit(anomalies === 0 ? 0 : 2)
