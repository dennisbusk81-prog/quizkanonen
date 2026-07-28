// Read-only DB-sjekk: bekrefter at shuffle_options er satt likt på alle spørsmål
// i quizen. Gjør INGEN skriv, oppretter INGEN attempt. Kalles:
//   node scripts/verify-shuffle-db.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Enkel .env.local-parser (kun for å hente URL + service role lokalt)
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Mangler Supabase-URL/nøkkel i .env.local'); process.exit(1) }

const QUIZ_ID = '3053b3d1-0d4f-438e-a0fb-d5427dffce33'
const supabase = createClient(url, key)

const { data, error } = await supabase
  .from('questions')
  .select('id, order_index, shuffle_options')
  .eq('quiz_id', QUIZ_ID)
  .order('order_index', { ascending: true })

if (error) { console.error('SELECT feilet:', error.message); process.exit(1) }

console.log(`Quiz: ${QUIZ_ID}`)
console.log(`Antall spørsmål: ${data.length}\n`)
const trueCount = data.filter(q => q.shuffle_options === true).length
const falseCount = data.filter(q => q.shuffle_options === false).length
for (const q of data) {
  console.log(`  order_index=${String(q.order_index).padStart(2)}  shuffle_options=${q.shuffle_options}`)
}
console.log(`\nSUM: true=${trueCount}, false=${falseCount}`)
console.log(trueCount === data.length && data.length > 0
  ? '✓ Alle spørsmål har shuffle_options=true — uniformt på quiz-nivå.'
  : '✗ IKKE uniformt — se listen over.')
