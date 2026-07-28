// READ-ONLY etterkontroll av backfill-timeout-answers.mjs.
// Tar et oyeblikksbilde av season_scores og alle quiz-leaderboards FOR
// backfillen, og sammenligner mot samme beregning ETTER.
//
//   node scripts/verify-timeout-backfill.mjs --snapshot   (kjores FOR --apply)
//   node scripts/verify-timeout-backfill.mjs --compare    (kjores ETTER --apply)
//
// Skriver kun til en lokal JSON-fil, aldri til databasen.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const MODE = process.argv.includes('--compare') ? 'compare'
  : process.argv.includes('--snapshot') ? 'snapshot' : null
if (!MODE) { console.error('Bruk --snapshot eller --compare'); process.exit(1) }

const SNAP = 'scripts/.timeout-backfill-snapshot.json'

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

const [attempts, seasonRows] = await Promise.all([
  fetchAll('attempts', 'id, quiz_id, user_id, player_name, correct_answers, total_time_ms, correct_streak, is_team, submitted_at', q => q.not('submitted_at', 'is', null)),
  fetchAll('season_scores', 'id, user_id, quiz_id, scope_type, scope_id, points, rank'),
])

// Leaderboard-plassering per (quiz, rom, spiller)
const leaderboard = {}
for (const quizId of new Set(attempts.map(a => a.quiz_id))) {
  for (const isTeam of [false, true]) {
    const room = attempts.filter(a => a.quiz_id === quizId && a.is_team === isTeam)
    if (room.length === 0) continue
    for (const r of rankQuizAttempts(room)) {
      leaderboard[`${quizId}|${isTeam ? 'lag' : 'solo'}|${r.id}`] = r.rank
    }
  }
}
const season = {}
for (const r of seasonRows) {
  season[`${r.user_id}|${r.quiz_id}|${r.scope_type}|${r.scope_id ?? 'null'}`] = `${r.rank}:${r.points}`
}

const state = { leaderboard, season, takenAt: new Date().toISOString() }

if (MODE === 'snapshot') {
  writeFileSync(SNAP, JSON.stringify(state, null, 0))
  console.log(`Oyeblikksbilde lagret: ${SNAP}`)
  console.log(`  leaderboard-plasseringer: ${Object.keys(leaderboard).length}`)
  console.log(`  season_scores-rader:      ${Object.keys(season).length}`)
  process.exit(0)
}

if (!existsSync(SNAP)) { console.error(`Fant ikke ${SNAP} — kjor --snapshot FOR backfillen.`); process.exit(1) }
const before = JSON.parse(readFileSync(SNAP, 'utf8'))

function diff(a, b, label) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const changed = []
  for (const k of keys) if (a[k] !== b[k]) changed.push(`${k}: ${a[k] ?? '(mangler)'} -> ${b[k] ?? '(mangler)'}`)
  console.log(`\n${label}: ${changed.length === 0 ? 'INGEN ENDRING' : `${changed.length} ENDRING(ER)`}`)
  for (const c of changed.slice(0, 40)) console.log('   ', c)
  return changed.length
}

console.log(`Sammenligner mot oyeblikksbilde fra ${before.takenAt}`)
const lbChanged = diff(before.leaderboard, leaderboard, 'Quiz-leaderboard-plasseringer')
const ssChanged = diff(before.season, season, 'season_scores (rank:points)')

console.log(`\n${lbChanged === 0 && ssChanged === 0
  ? 'BEKREFTET: backfillen var usynlig — ingen plassering eller sesongpoeng endret seg.'
  : 'ADVARSEL: noe endret seg — se listen over.'}`)
process.exit(lbChanged === 0 && ssChanged === 0 ? 0 : 1)
