// Read-only sjekk: bekrefter faktisk returtype (objekt vs array) for
// profiles(display_name)-embed i season_scores-spørringen brukt av
// app/api/org/[slug]/season-summary/route.ts, og at fikset parse-logikk
// (objekt, ikke array) faktisk gir riktig displayName. Gjør INGEN skriv.
//   node scripts/verify-season-summary-embed.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Mangler Supabase-URL/nøkkel i .env.local'); process.exit(1) }

const supabase = createClient(url, key)

const { data, error } = await supabase
  .from('season_scores')
  .select('user_id, points, profiles(display_name)')
  .limit(5)

if (error) { console.error('SELECT feilet:', error.message); process.exit(1) }

console.log(`Antall rader: ${data.length}\n`)
console.log('--- Gammel logikk (row.profiles?.[0]?.display_name) ---')
for (const row of data) {
  const oldName = row.profiles?.[0]?.display_name
  console.log(`  user_id=${row.user_id.slice(0,8)} -> name=${JSON.stringify(oldName)}`)
}

console.log('\n--- Ny logikk (row.profiles?.display_name) ---')
for (const row of data) {
  const newName = row.profiles?.display_name
  console.log(`  user_id=${row.user_id.slice(0,8)} -> name=${JSON.stringify(newName)}`)
}
