// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY forhandssjekk for UNIQUE-constraint pa
// attempt_answers(attempt_id, question_id).
//
// CREATE UNIQUE INDEX feiler hvis det finnes duplikate (attempt_id, question_id)
// i tabellen. Dette skriptet teller nøyaktig hvor mange rader som ville blokkert
// den, og hvor mange rader som matte vaert fjernet for a fa den pa plass.
//
// Skriver ALDRI til databasen.
//   node scripts/check-unique-constraint-blockers.mjs
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

const [answers, attempts, quizzes] = await Promise.all([
  fetchAll('attempt_answers', 'id, attempt_id, question_id, is_correct, selected_answer, time_ms'),
  fetchAll('attempts', 'id, quiz_id, player_name, submitted_at'),
  fetchAll('quizzes', 'id, title'),
])
const attById = new Map(attempts.map(a => [a.id, a]))
const titleById = new Map(quizzes.map(q => [q.id, q.title]))

// Grupper pa den tiltenkte unike nokkelen
const groups = new Map()
for (const r of answers) {
  const key = `${r.attempt_id}|${r.question_id}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}

const dupeGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1)
const excessRows = dupeGroups.reduce((sum, [, rows]) => sum + (rows.length - 1), 0)
const affectedAttempts = new Set(dupeGroups.map(([k]) => k.split('|')[0]))

// Orphans: rader som peker pa et forsok som ikke finnes
const orphans = answers.filter(r => !attById.has(r.attempt_id))

console.log('══════════════════════════════════════════════════════════════')
console.log('FORHANDSSJEKK — UNIQUE (attempt_id, question_id) pa attempt_answers')
console.log('══════════════════════════════════════════════════════════════\n')
console.log(`Rader i attempt_answers totalt:              ${answers.length}`)
console.log(`Distinkte (attempt_id, question_id):         ${groups.size}`)
console.log(`Nokler med MER enn en rad (blokkerer):       ${dupeGroups.length}`)
console.log(`Overskytende rader som ma bort:              ${excessRows}`)
console.log(`Berorte forsok:                              ${affectedAttempts.size}`)
console.log(`Foreldrelose rader (ukjent attempt_id):      ${orphans.length}`)

console.log(`\nKONKLUSJON: ${dupeGroups.length === 0
  ? 'CREATE UNIQUE INDEX ville lykkes na.'
  : 'CREATE UNIQUE INDEX ville FEILE (23505) — duplikatene ma ryddes forst.'}`)

if (dupeGroups.length === 0) process.exit(0)

// Per forsok
console.log('\n── Blokkerende forsok ──')
console.log('  SPILLER                   QUIZ            NOKLER  OVERSKYTENDE  UENIGE')
const perAttempt = new Map()
for (const [key, rows] of dupeGroups) {
  const aid = key.split('|')[0]
  if (!perAttempt.has(aid)) perAttempt.set(aid, { keys: 0, excess: 0, conflict: false })
  const e = perAttempt.get(aid)
  e.keys++
  e.excess += rows.length - 1
  const vals = new Set(rows.map(r => r.is_correct))
  const answersDiffer = new Set(rows.map(r => JSON.stringify(r.selected_answer))).size > 1
  if (vals.size > 1 || answersDiffer) e.conflict = true
}
for (const [aid, e] of [...perAttempt.entries()].sort((a, b) => b[1].excess - a[1].excess)) {
  const at = attById.get(aid)
  const t = (titleById.get(at?.quiz_id) ?? '').replace('Fredagsquiz ', '').slice(0, 12)
  console.log(`  ${(at?.player_name ?? '(ukjent)').slice(0, 24).padEnd(26)}${t.padEnd(16)}${String(e.keys).padStart(5)}${String(e.excess).padStart(13)}       ${e.conflict ? 'JA' : 'nei'}`)
}

const conflictCount = [...perAttempt.values()].filter(e => e.conflict).length
console.log(`\n  Forsok der duplikatene er IDENTISKE (trygt a beholde vilkarlig rad): ${perAttempt.size - conflictCount}`)
console.log(`  Forsok der duplikatene er ULIKE (krever en beslutning):              ${conflictCount}`)
console.log('\n  For de ulike: radene har forskjellig svar/tid, altsa to reelle')
console.log('  svarregistreringer pa samme sporsmal. Hvilken som skal beholdes er')
console.log('  et produktsporsmal, ikke et teknisk — derfor ingen automatisk rydding her.')
