// ─────────────────────────────────────────────────────────────────────────────
// SYNKRONISERER season_scores etter at attempts ble korrigert (DEL 2).
//
// BAKGRUNN: season_scores er et ØYEBLIKKSBILDE skrevet ÉN gang av
// lib/award-season-points.ts da quizen stengte. Ingenting re-trigger den når
// historiske attempts rettes i ettertid. Etter DEL 2 sin --apply er derfor
// attempts.correct_answers riktig, mens season_scores.rank/points fortsatt
// viser de gamle, oppblåste tallene — og season_scores er nettopp det
// /api/toppliste leser for toppliste, org-standings og periode-aggregater.
//
// Dette skriptet rekalkulerer rank/points for de berørte quizene med NØYAKTIG
// samme algoritme som award-season-points.ts bruker ved normal stenging
// (speilet linje for linje nedenfor), og oppdaterer kun de radene som faktisk
// avviker.
//
// MERK — hvorfor UPDATE og ikke upsert: award-season-points.ts sin upsert
// bruker `ignoreDuplicates: true`, som betyr at den ALDRI overskriver
// eksisterende rader. Å bare kjøre den på nytt ville derfor ikke gjort noe.
//
// RØRER IKKE: closes_at (periodetilhørighet må stå urørt), attempts,
// attempt_answers, eller noen annen tabell. Kun season_scores.rank/points.
//
// KJØRING:
//   node scripts/sync-season-scores-after-correction.mjs           → DRY RUN
//   node scripts/sync-season-scores-after-correction.mjs --apply   → skriver
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

// ── Speilet UENDRET fra lib/season-points.ts ────────────────────────────────
const SEASON_POINTS_TABLE = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]
const getPoints = rank => (rank <= 10 ? SEASON_POINTS_TABLE[rank - 1] : 1)

function pickBestSeasonAttempt(a, b) {
  if (b.correct_answers > a.correct_answers) return b
  if (b.correct_answers === a.correct_answers && b.total_time_ms < a.total_time_ms) return b
  if (
    b.correct_answers === a.correct_answers &&
    b.total_time_ms === a.total_time_ms &&
    (b.correct_streak ?? 0) > (a.correct_streak ?? 0)
  ) return b
  return a
}

function rankSeasonAttempts(bestByUser) {
  const sorted = [...bestByUser.entries()].sort(([, a], [, b]) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
    return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  })
  const result = []
  for (let i = 0; i < sorted.length; i++) {
    let rank = i + 1
    if (i > 0) {
      const [, prev] = sorted[i - 1]
      const [, cur] = sorted[i]
      if (cur.correct_answers === prev.correct_answers && cur.total_time_ms === prev.total_time_ms) {
        rank = result[i - 1].rank
      }
    }
    result.push({ userId: sorted[i][0], rank })
  }
  return result
}

// ── Rangerings-kart per scope, med HISTORISK populasjon ─────────────────────
//
// VIKTIG DESIGNVALG (funn under bygging av dette skriptet):
// En naiv gjenkjøring av award-season-points ville brukt DAGENS medlemskap. Men
// medlemskap har driftet siden quizene stengte — bekreftet mot prod:
//   - Thomas Sørensen, Nils Martin Øyo og Line Kittelsen har opt_out=true I DAG,
//     men har legitime globale rader fra da de ikke var utmeldt.
//   - Kevin Lu og Carlos Medellín har 0 liga-medlemskap i dag, men har
//     liga-rader fra da de var medlemmer.
// En gjenkjøring ville dermed slettet/foreldreløsgjort disse menneskenes
// historiske plasseringer basert på dagens medlemskap. Det ville vært en
// retroaktiv omskriving av historikk, ikke en retting.
//
// Derfor:
//   - GLOBAL: rangeres over HELE attempt-populasjonen, nøyaktig som kilden
//     (award-season-points rangerer først, filtrerer blokkerte bort ETTERPÅ —
//     så rank-tallene er uavhengige av hvem som er blokkert). Trygt og stabilt.
//   - LIGA/ORG: den historiske populasjonen rekonstrueres fra de LAGREDE
//     radene for (quiz, scope) — de forteller nøyaktig hvem som var med da
//     quizen stengte. Vi rangerer den gruppen på nytt med dagens (rettede)
//     attempts-tall.
//
// Ingen rad settes noensinne inn eller slettes — kun rank/points oppdateres.
async function computeRankMaps(quizId, storedRowsForQuiz) {
  const rawAttempts = await fetchAll('attempts', 'user_id, correct_answers, total_time_ms, correct_streak',
    q => q.eq('quiz_id', quizId).eq('is_team', false).not('user_id', 'is', null))

  const bestByUser = new Map()
  for (const a of rawAttempts) {
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBestSeasonAttempt(existing, a) : a)
  }

  // GLOBAL — full populasjon (samme som kilden sin rankBestAttempts(bestByUser))
  const globalRank = new Map(rankSeasonAttempts(bestByUser).map(r => [r.userId, r.rank]))

  // LIGA/ORG — historisk populasjon fra lagrede rader
  const scopedRank = new Map() // `${scope_type}|${scope_id}` -> Map(userId -> rank)
  const scopeMembers = new Map()
  for (const r of storedRowsForQuiz) {
    if (r.scope_type === 'global') continue
    const k = `${r.scope_type}|${r.scope_id}`
    if (!scopeMembers.has(k)) scopeMembers.set(k, new Set())
    scopeMembers.get(k).add(r.user_id)
  }
  for (const [k, members] of scopeMembers) {
    const subset = new Map()
    for (const uid of members) { const a = bestByUser.get(uid); if (a) subset.set(uid, a) }
    if (subset.size === 0) continue
    scopedRank.set(k, new Map(rankSeasonAttempts(subset).map(r => [r.userId, r.rank])))
  }

  return { globalRank, scopedRank, hasAttempt: uid => bestByUser.has(uid) }
}

console.log(APPLY
  ? '*** APPLY-MODUS — DETTE OPPDATERER season_scores ***\n'
  : '=== DRY RUN — ingen skriving. Bruk --apply for a utfore. ===\n')

// De 6 korrigerte forsøkene ligger på disse 4 quizene.
const CORRECTED = [
  { name: 'Morten Kristiansen Røed', quizMatch: '10.07' },
  { name: 'Elisabeth Sandberg Kvebek', quizMatch: '10.07' },
  { name: 'Tiril Stenhammer', quizMatch: '19.06' },
  { name: 'Magnus Rolstad', quizMatch: '19.06' },
  { name: 'Håkon Lorentsen', quizMatch: '26.06' },
  { name: 'Mari Tangvall Eggen', quizMatch: '17.07' },
]

const [quizzes, profiles, orgs, seasonRows] = await Promise.all([
  fetchAll('quizzes', 'id, title, closes_at'),
  fetchAll('profiles', 'id, display_name'),
  fetchAll('organizations', 'id, name'),
  fetchAll('season_scores', 'id, user_id, quiz_id, scope_type, scope_id, points, rank, closes_at'),
])
const profileById = new Map(profiles.map(p => [p.id, p]))
const orgById = new Map(orgs.map(o => [o.id, o]))
const nameFor = uid => profileById.get(uid)?.display_name ?? uid.slice(0, 8)
const scopeLabel = r => r.scope_type === 'global' ? 'GLOBAL'
  : r.scope_type === 'organization' ? `ORG(${orgById.get(r.scope_id)?.name ?? r.scope_id?.slice(0, 8)})`
  : `LIGA(${r.scope_id?.slice(0, 8)})`

const affectedQuizIds = [...new Set(CORRECTED.map(c => quizzes.find(q => q.title.includes(c.quizMatch)).id))]
console.log(`Berorte quizer: ${affectedQuizIds.length}`)
for (const qid of affectedQuizIds) console.log(`   ${quizzes.find(q => q.id === qid).title}`)

// ── FASE 1 — rekalkuler og sammenlign ───────────────────────────────────────
console.log('\n== FASE 1 — rekalkulert vs. lagret season_scores ==\n')

const updates = []
let unresolvable = 0

for (const quizId of affectedQuizIds) {
  const quiz = quizzes.find(q => q.id === quizId)
  const stored = seasonRows.filter(r => r.quiz_id === quizId)
  const { globalRank, scopedRank, hasAttempt } = await computeRankMaps(quizId, stored)

  const diffs = []
  for (const s of stored) {
    const newRank = s.scope_type === 'global'
      ? globalRank.get(s.user_id)
      : scopedRank.get(`${s.scope_type}|${s.scope_id}`)?.get(s.user_id)

    if (newRank === undefined) {
      // Skjer kun hvis en lagret rad peker på en bruker uten forsøk på quizen —
      // da kan vi ikke utlede en plassering, og raden lates i fred.
      unresolvable++
      console.log(`   ⚠ KAN IKKE UTLEDE rank: ${nameFor(s.user_id)} ${scopeLabel(s)} (har forsok: ${hasAttempt(s.user_id)}) — raden rores ikke`)
      continue
    }
    const newPoints = getPoints(newRank)
    if (s.rank !== newRank || s.points !== newPoints) {
      diffs.push({ stored: s, rank: newRank, points: newPoints })
      updates.push({ id: s.id, rank: newRank, points: newPoints, user_id: s.user_id, quizTitle: quiz.title })
    }
  }

  console.log(`${quiz.title}: ${stored.length} lagrede rader, ${diffs.length} avviker`)
  const byScope = new Map()
  for (const d of diffs) {
    const lbl = scopeLabel(d.stored)
    if (!byScope.has(lbl)) byScope.set(lbl, [])
    byScope.get(lbl).push(d)
  }
  for (const [lbl, list] of byScope) {
    console.log(`   ${lbl}: ${list.length} rader endres`)
    for (const d of list.sort((a, b) => a.rank - b.rank)) {
      console.log(`      ${nameFor(d.stored.user_id).padEnd(28)} rank ${String(d.stored.rank).padStart(2)} → ${String(d.rank).padStart(2)}   poeng ${String(d.stored.points).padStart(2)} → ${String(d.points).padStart(2)}`)
    }
  }
  console.log('')
}

console.log(`Totalt season_scores-rader som oppdateres: ${updates.length}`)
if (unresolvable > 0) console.log(`Rader som ikke kunne utledes og derfor ikke rores: ${unresolvable}`)

// ── FASE 2 — BEVIS at periode-aggregatene er levende summeringer ────────────
console.log('\n== FASE 2 — BEVIS: periode-aggregater trenger ingen egen skriving ==\n')
console.log('Mekanisme (fra supabase/migrations/20260614000014_season_leaderboard_rpc.sql):')
console.log('   SELECT ss.user_id, SUM(ss.points) ... FROM public.season_scores ss')
console.log('   WHERE ss.scope_type = p_scope AND ss.closes_at >= p_period_start ...')
console.log('   GROUP BY ss.user_id')
console.log('-> Det finnes INGEN egen tabell for maaned/kvartal/aar. Hver periode er')
console.log('   en SUM over de samme season_scores-radene, filtrert paa closes_at.')
console.log('   Naar en rads points endres, endres periodesummen automatisk.\n')

const MORTEN = '582ea3fb-2665-462d-a681-037103ffd07a'
const ELKJOP = orgs.find(o => o.name === 'Elkjøp Nordic')
const JULY_START = '2026-07-01T00:00:00.000Z'
const JULY_END = '2026-08-01T00:00:00.000Z'

// (a) LIVE verdi fra den EKTE RPC-en appen bruker — ikke min egen beregning.
const { data: rpcNow, error: rpcErr } = await sb.rpc('season_leaderboard_ranked', {
  p_scope: 'organization', p_scope_id: ELKJOP.id,
  p_period_start: JULY_START, p_period_end: JULY_END,
  p_excluded_ids: [], p_page: 1, p_page_size: 100, p_search: null,
})
const mortenNow = (rpcNow ?? []).find(r => r.user_id === MORTEN)
console.log(`(a) LIVE fra RPC season_leaderboard_ranked (org Elkjøp, juli 2026) NAA:`)
if (rpcErr) console.log(`    RPC-feil: ${rpcErr.message}`)
else console.log(`    Morten: ${mortenNow?.points ?? '(ingen)'} poeng, rank ${mortenNow?.rank ?? '-'}`)

// (b) Summer selv over LAGREDE rader (skal matche RPC-en over)
const storedJulyOrg = seasonRows.filter(r =>
  r.scope_type === 'organization' && r.scope_id === ELKJOP.id &&
  r.closes_at >= JULY_START && r.closes_at < JULY_END)
const storedMortenSum = storedJulyOrg.filter(r => r.user_id === MORTEN).reduce((s, r) => s + r.points, 0)
console.log(`\n(b) Min egen SUM over LAGREDE rader (samme filter): ${storedMortenSum} poeng`)
console.log(`    ${storedMortenSum === Number(mortenNow?.points ?? -1) ? '✓ MATCHER RPC-en' : '✗ AVVIKER fra RPC-en'} — bekrefter at RPC-en kun summerer disse radene.`)

// (c) Hva summen BLIR etter oppdateringen (samme rader, nye points)
const updateById = new Map(updates.map(u => [u.id, u]))
const predictedMortenSum = storedJulyOrg
  .filter(r => r.user_id === MORTEN)
  .reduce((s, r) => s + (updateById.get(r.id)?.points ?? r.points), 0)
console.log(`\n(c) FORUTSAGT sum etter oppdatering: ${predictedMortenSum} poeng`)
console.log(`    Mortens juli-rader i org-scope:`)
for (const r of storedJulyOrg.filter(x => x.user_id === MORTEN)) {
  const u = updateById.get(r.id)
  const t = quizzes.find(q => q.id === r.quiz_id)?.title ?? r.quiz_id.slice(0, 8)
  console.log(`       ${t.padEnd(24)} ${r.points}p${u ? ` → ${u.points}p  (rank ${r.rank} → ${u.rank})` : '  (uendret)'}`)
}
console.log(`\n    -> Ingen skriving mot noe periode-objekt: summen ${storedMortenSum} → ${predictedMortenSum}`)
console.log(`       foelger utelukkende av at ÉN season_scores-rad endrer points.`)
console.log(`       Etter --apply kan samme RPC-kall kjoeres paa nytt for aa bekrefte.`)

if (!APPLY) {
  console.log('\n=== DRY RUN FERDIG — ingenting ble skrevet. ===')
  process.exit(0)
}

// ── FASE 3 — utforelse ──────────────────────────────────────────────────────
console.log('\n== FASE 3 — SKRIVER TIL season_scores ==')
let done = 0
for (const u of updates) {
  const { error } = await sb.from('season_scores')
    .update({ rank: u.rank, points: u.points })
    .eq('id', u.id)
  if (error) { console.error(`   UPDATE FEILET for ${u.id}:`, error.message); process.exit(1) }
  done++
  if (done % 10 === 0 || done === updates.length) console.log(`   oppdatert ${done}/${updates.length}`)
}
console.log(`\n== FERDIG ==\n   season_scores-rader oppdatert: ${done}`)

// Etterkontroll: samme RPC-kall som i FASE 2 (a)
const { data: rpcAfter } = await sb.rpc('season_leaderboard_ranked', {
  p_scope: 'organization', p_scope_id: ELKJOP.id,
  p_period_start: JULY_START, p_period_end: JULY_END,
  p_excluded_ids: [], p_page: 1, p_page_size: 100, p_search: null,
})
const mortenAfter = (rpcAfter ?? []).find(r => r.user_id === MORTEN)
console.log(`\n== ETTERKONTROLL — samme LIVE RPC-kall som i FASE 2(a) ==`)
console.log(`   Morten org-juli FOER:      ${storedMortenSum} poeng`)
console.log(`   FORUTSAGT:                 ${predictedMortenSum} poeng`)
console.log(`   LIVE ETTER (fra RPC):      ${mortenAfter?.points ?? '(ingen)'} poeng, rank ${mortenAfter?.rank ?? '-'}`)
console.log(`   ${Number(mortenAfter?.points ?? -1) === predictedMortenSum ? '✓ BEKREFTET — periode-aggregatet fulgte automatisk, uten egen skriving.' : '✗ AVVIK — undersoek.'}`)
