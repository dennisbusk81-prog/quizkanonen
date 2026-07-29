// ─────────────────────────────────────────────────────────────────────────────
// OPPRYDDING av duplikate attempt_answers-rader som betyr det SAMME.
//
// Sletter overskytende rader og beholder ÉN rad per (attempt_id, question_id),
// i to tilfeller:
//
//   NIVÅ A — radene er helt like: samme selected_answer, samme is_correct,
//            samme time_ms. Kopien bærer ingen informasjon i det hele tatt.
//   NIVÅ B — samme selected_answer og samme is_correct, men ulik time_ms.
//            Spilleren svarte det samme; kun det registrerte tidsstempelet
//            skiller. total_time_ms leses fra attempts, ikke summeres fra disse
//            radene, så valget av rad påvirker ingenting spillerne ser. Eneste
//            berørte flate er snitt-tid per spørsmål i admin-analysen.
//
// RØRER IKKE de forsøkene der duplikatene har ULIKT SVAR eller ulik korrekthet.
// Der er det to reelle svarregistreringer, og hvilken som skal gjelde er en
// egen beslutning som påvirker correct_answers, plassering og sesongpoeng.
//
// I begge nivåer beholdes raden med lavest id — vilkårlig, men deterministisk,
// slik at en ny kjøring ville tatt samme valg.
//
// RØRER IKKE attempts i det hele tatt — verken correct_answers, correct_streak
// eller total_time_ms. Oppryddingen er derfor usynlig for spillerne: alt som
// vises kommer fra attempts, ikke fra antall rader i attempt_answers.
//
// ⚠️ MERK: tre av disse forsøkene har i dag for høy correct_answers fordi
// duplikatet ble talt med av admin-rutens opptelling (Peter Kaaber 9 mot 8,
// Marianne Sundling 12 mot 11, Stine Sjo 6 mot 5). Denne oppryddingen retter
// IKKE det — den lar de lagrede tallene stå nøyaktig som de er. Men den fjerner
// grunnlaget for oppblåsingen, så en fremtidig fasitendring på de quizene vil
// telle riktig og dermed justere tallene ned. Se rapporten for detaljer.
//
// SIKKERHET:
//   - Hver gruppe verifiseres på nytt som identisk her, uavhengig av tidligere
//     analyse. Er den ikke det, hoppes forsøket over.
//   - Alle rader som skal slettes skrives til en lokal JSON-fil FØR slettingen,
//     slik at de kan settes inn igjen om nødvendig.
//   - Sletting skjer på eksplisitt liste av rad-id-er, aldri på filter.
//
// KJØRING:
//   node scripts/cleanup-identical-duplicate-answers.mjs           → DRY RUN
//   node scripts/cleanup-identical-duplicate-answers.mjs --apply   → sletter
//
// Idempotent: andre kjøring finner 0 rader å slette.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const BACKUP = 'scripts/.deleted-duplicate-answers-backup.json'

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
  ? '*** APPLY-MODUS — DETTE SLETTER RADER I DATABASEN ***\n'
  : '=== DRY RUN — ingen sletting. Bruk --apply for a utfore. ===\n')

const [answers, attempts, quizzes] = await Promise.all([
  fetchAll('attempt_answers', 'id, attempt_id, question_id, selected_answer, is_correct, time_ms'),
  fetchAll('attempts', 'id, quiz_id, player_name, total_questions, correct_answers'),
  fetchAll('quizzes', 'id, title'),
])
const attById = new Map(attempts.map(a => [a.id, a]))
const titleById = new Map(quizzes.map(q => [q.id, q.title]))

// Grupper pa (attempt_id, question_id)
const groups = new Map()
for (const r of answers) {
  const key = `${r.attempt_id}|${r.question_id}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}

// NIVÅ A: helt like rader (svar + korrekthet + tid).
function fullyIdentical(rows) {
  const sig = r => JSON.stringify([r.selected_answer, r.is_correct, r.time_ms])
  return rows.every(r => sig(r) === sig(rows[0]))
}
// NIVÅ B (og A): samme svar og samme korrekthet — tid kan avvike.
function sameAnswer(rows) {
  const sig = r => JSON.stringify([r.selected_answer, r.is_correct])
  return rows.every(r => sig(r) === sig(rows[0]))
}

// Et forsok kan ryddes hvis ALLE duplikatgruppene har samme svar+korrekthet.
const perAttempt = new Map()
for (const [key, rows] of groups) {
  if (rows.length < 2) continue
  const aid = key.split('|')[0]
  if (!perAttempt.has(aid)) perAttempt.set(aid, { groups: [], cleanable: true, timeOnlyGroups: 0 })
  const e = perAttempt.get(aid)
  e.groups.push({ key, rows })
  if (!sameAnswer(rows)) e.cleanable = false
  else if (!fullyIdentical(rows)) e.timeOnlyGroups++
}

const cleanTargets = [...perAttempt.entries()].filter(([, e]) => e.cleanable)
const deferred = [...perAttempt.entries()].filter(([, e]) => !e.cleanable)

const toDelete = []
for (const [, e] of cleanTargets) {
  for (const g of e.groups) {
    // Behold raden med lavest id (deterministisk), slett resten.
    const sorted = [...g.rows].sort((a, b) => a.id.localeCompare(b.id))
    toDelete.push(...sorted.slice(1))
  }
}

console.log('== FASE 1 — hva som skal slettes ==')
console.log(`   Forsok som ryddes na (samme svar + korrekthet):   ${cleanTargets.length}`)
console.log(`   Forsok med ULIKT SVAR (venter, rores ikke):       ${deferred.length}`)
console.log(`   Rader som slettes:                                ${toDelete.length}`)

if (cleanTargets.length > 0) {
  console.log('\n   Ryddes na:')
  console.log('   ' + 'SPILLER'.padEnd(26) + 'QUIZ'.padEnd(14) + 'SLETTES  BEHOLDES  NIVA')
  for (const [aid, e] of cleanTargets.sort((a, b) => b[1].groups.length - a[1].groups.length)) {
    const at = attById.get(aid)
    const del = e.groups.reduce((s, g) => s + g.rows.length - 1, 0)
    const t = (titleById.get(at?.quiz_id) ?? '').replace('Fredagsquiz ', '').slice(0, 11)
    const niva = e.timeOnlyGroups > 0 ? `B (ulik tid i ${e.timeOnlyGroups})` : 'A (helt like)'
    console.log(`   ${(at?.player_name ?? '?').slice(0, 24).padEnd(26)}${t.padEnd(14)}${String(del).padStart(7)}${String(e.groups.length).padStart(10)}  ${niva}`)
  }
}
if (deferred.length > 0) {
  console.log('\n   Venter paa beslutning (IKKE rort) — genuint ulikt svar:')
  for (const [aid, e] of deferred) {
    const at = attById.get(aid)
    const diff = e.groups.filter(g => !sameAnswer(g.rows)).length
    console.log(`     ${(at?.player_name ?? '?').padEnd(26)}${(titleById.get(at?.quiz_id) ?? '').slice(0, 24).padEnd(26)}${diff} gruppe(r) med ulikt svar`)
  }
}

// ── FASE 2 — kontroll av at ingenting gaar tapt ─────────────────────────────
console.log('\n== FASE 2 — kontroll ==')
let problems = 0
for (const [aid, e] of cleanTargets) {
  const at = attById.get(aid)
  const all = answers.filter(r => r.attempt_id === aid)
  const distinctAfter = new Set(all.map(r => r.question_id)).size
  const rowsAfter = all.length - e.groups.reduce((s, g) => s + g.rows.length - 1, 0)
  if (rowsAfter !== distinctAfter) {
    problems++
    console.log(`   FEIL: ${at?.player_name} ville hatt ${rowsAfter} rader men ${distinctAfter} distinkte`)
  }
  if (distinctAfter !== at?.total_questions) {
    console.log(`   MERK: ${at?.player_name} har ${distinctAfter} distinkte sporsmal, total_questions=${at?.total_questions}`)
  }
}
console.log(`   Forsok der radtall etter sletting == distinkte sporsmal: ${cleanTargets.length - problems}/${cleanTargets.length}`)
if (problems > 0) { console.log('   STOPPER — kontrollen feilet.'); process.exit(1) }

// Alle rader som slettes maa ha en identisk soskenrad som beholdes
const keepIds = new Set()
for (const [, e] of cleanTargets) {
  for (const g of e.groups) {
    const sorted = [...g.rows].sort((a, b) => a.id.localeCompare(b.id))
    keepIds.add(sorted[0].id)
  }
}
let answerMismatch = 0, timeOnlyDiff = 0
for (const d of toDelete) {
  const g = groups.get(`${d.attempt_id}|${d.question_id}`)
  const kept = g.find(r => keepIds.has(r.id))
  // Kritisk: svaret og korrektheten MÅ være bevart. Dette er det eneste som
  // paavirker score. Avvik her betyr at vi ville kastet et reelt svar.
  if (!kept || JSON.stringify([kept.selected_answer, kept.is_correct]) !== JSON.stringify([d.selected_answer, d.is_correct])) {
    answerMismatch++
  } else if (kept.time_ms !== d.time_ms) {
    timeOnlyDiff++
  }
}
console.log(`   Rader som slettes der svar/korrekthet IKKE er bevart: ${answerMismatch}`)
if (answerMismatch > 0) { console.log('   STOPPER — ville mistet et reelt svar.'); process.exit(1) }
console.log(`   Rader der kun time_ms avviker fra raden som beholdes:  ${timeOnlyDiff}`)
console.log('   -> Svar og korrekthet er bevart for hver eneste slettede rad.')

console.log('\n== FASE 3 — effekt paa det spillerne ser ==')
console.log('   attempts rores ikke (correct_answers, correct_streak, total_time_ms).')
console.log('   Alt som vises paa leaderboard/toppliste leses fra attempts.')
console.log('   Forventet synlig endring: INGEN.')

if (!APPLY) {
  console.log('\n=== DRY RUN FERDIG — ingenting ble slettet. ===')
  process.exit(0)
}

// ── FASE 4 — sikkerhetskopi og sletting ─────────────────────────────────────
writeFileSync(BACKUP, JSON.stringify(toDelete, null, 2))
console.log(`\n== FASE 4 — SLETTER ==`)
console.log(`   Sikkerhetskopi av ${toDelete.length} rader skrevet til ${BACKUP}`)

let deleted = 0
const ids = toDelete.map(r => r.id)
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100)
  const { error } = await sb.from('attempt_answers').delete().in('id', chunk)
  if (error) { console.error('   DELETE FEILET:', error.message); process.exit(1) }
  deleted += chunk.length
  console.log(`   slettet ${deleted}/${ids.length}`)
}
console.log(`\n== FERDIG ==\n   attempt_answers-rader slettet: ${deleted}`)
