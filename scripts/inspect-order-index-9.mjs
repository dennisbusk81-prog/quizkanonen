// Read-only: viser de to radene med order_index=9 (id, order_index, tekst).
// Gjør INGEN skriv. Kalles: node scripts/inspect-order-index-9.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const QUIZ_ID = '3053b3d1-0d4f-438e-a0fb-d5427dffce33'

// Full liste for kontekst rundt posisjonen
const { data, error } = await supabase
  .from('questions')
  .select('id, order_index, question_text, category, option_a, option_b, option_c, option_d')
  .eq('quiz_id', QUIZ_ID)
  .order('order_index', { ascending: true })
  .order('id', { ascending: true })

if (error) { console.error('SELECT feilet:', error.message); process.exit(1) }

console.log(`Quiz: ${QUIZ_ID}  (${data.length} spørsmål)\n`)
for (const q of data) {
  const mark = q.order_index === 9 ? '  <== order_index=9' : ''
  console.log(`  oi=${String(q.order_index).padStart(2)}  ${q.id}${mark}`)
  console.log(`        "${String(q.question_text).slice(0, 100)}"  [${q.category ?? '—'}]`)
}

console.log('\n── Detaljer for de to order_index=9-radene ─────────────────')
for (const q of data.filter(r => r.order_index === 9)) {
  console.log(`\n  id: ${q.id}`)
  console.log(`  tekst: "${q.question_text}"`)
  console.log(`  kategori: ${q.category ?? '—'}`)
  console.log(`  A: ${q.option_a}`)
  console.log(`  B: ${q.option_b}`)
  console.log(`  C: ${q.option_c ?? '—'}`)
  console.log(`  D: ${q.option_d ?? '—'}`)
}
