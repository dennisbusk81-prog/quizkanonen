// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY: hvor synlig er Morten Kristiansen Røed sin mulige 10.07-korreksjon
// på AKTIVE, ikke-nullstilte topplister i dag (25. juli 2026)?
//
// Sjekker season_scores-aggregering for month/quarter/year/alltime, org-scope
// Elkjøp Nordic, og tilsvarende global-scope, og regner ut nøyaktig hvilke tall
// og plasseringer som ville endre seg for hver periode.
//
// Skriver ALDRI til databasen.
//   node scripts/check-morten-period-visibility.mjs
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

const MORTEN_USER_ID = '582ea3fb-2665-462d-a681-037103ffd07a'
const QUIZ_1007 = '1fe32d7d-bbcf-41e2-8ea6-ed4e1c2d996d'
const SEASON_POINTS_TABLE = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]
const getPoints = rank => (rank <= 10 ? SEASON_POINTS_TABLE[rank - 1] : 1)

function compareAttempts(a, b) {
  if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
  if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
  return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
}
function rankSeason(bestByUser) {
  const sorted = [...bestByUser.entries()].sort(([, a], [, b]) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
    return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  })
  const res = []
  for (let i = 0; i < sorted.length; i++) {
    let rank = i + 1
    if (i > 0) {
      const [, prev] = sorted[i - 1]; const [, cur] = sorted[i]
      if (cur.correct_answers === prev.correct_answers && cur.total_time_ms === prev.total_time_ms) rank = res[i - 1].rank
    }
    res.push({ userId: sorted[i][0], rank })
  }
  return res
}

const [attempts, orgMembers, orgs, seasonRows, profiles, quiz1007] = await Promise.all([
  fetchAll('attempts', 'id, quiz_id, user_id, player_name, correct_answers, total_time_ms, correct_streak, is_team, submitted_at'),
  fetchAll('organization_members', 'user_id, organization_id, global_league_opt_out'),
  fetchAll('organizations', 'id, name, allow_global_league'),
  fetchAll('season_scores', 'id, user_id, quiz_id, scope_type, scope_id, points, rank, closes_at'),
  fetchAll('profiles', 'id, display_name'),
  sb.from('quizzes').select('id, title, closes_at').eq('id', QUIZ_1007).maybeSingle().then(r => r.data),
])

const elkjop = orgs.find(o => o.name === 'Elkjøp Nordic')
const profileById = new Map(profiles.map(p => [p.id, p]))
const orgMemberIds = orgMembers.filter(m => m.organization_id === elkjop.id).map(m => m.user_id)

console.log('══════════════════════════════════════════════════════════════')
console.log('KONTEKST')
console.log('══════════════════════════════════════════════════════════════')
console.log(`Elkjøp Nordic org-id: ${elkjop.id}, ${orgMemberIds.length} medlemmer`)
console.log(`10.07-quiz closes_at: ${quiz1007.closes_at}`)
console.log(`I dag: 2026-07-25`)

// ── Regn ut Mortens org-rank + poeng for 10.07 under de to variantene ────────
const pool1007 = attempts.filter(a => a.quiz_id === QUIZ_1007 && !a.is_team && a.user_id && orgMemberIds.includes(a.user_id))
const mortenAttempt = pool1007.find(a => a.user_id === MORTEN_USER_ID)

function orgRankFor(overrideCorrect) {
  const best = new Map()
  for (const a of pool1007) {
    const v = a.id === mortenAttempt.id ? { ...a, correct_answers: overrideCorrect } : a
    const cur = best.get(a.user_id)
    if (!cur || compareAttempts(v, cur) < 0) best.set(a.user_id, v)
  }
  return rankSeason(best)
}

const scenarios = {
  'Lagret i dag (12 rette)': mortenAttempt.correct_answers,
  'Variant "rad A" (11 rette)': 11,
  'Variant "rad B" (10 rette)': 10,
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log('1) MÅNED (JULI 2026) — ORG-SCOPE ELKJØP NORDIC')
console.log('══════════════════════════════════════════════════════════════')

const monthStart = '2026-07-01T00:00:00.000Z'
const monthEnd = '2026-08-01T00:00:00.000Z'
const orgSeasonRowsAllTime = seasonRows.filter(s => s.scope_type === 'organization' && s.scope_id === elkjop.id)
const orgSeasonRowsMonth = orgSeasonRowsAllTime.filter(s => s.closes_at >= monthStart && s.closes_at < monthEnd)

function sumPointsByUser(rows) {
  const agg = new Map()
  for (const r of rows) agg.set(r.user_id, (agg.get(r.user_id) ?? 0) + r.points)
  return agg
}
function rankFromPoints(agg) {
  return [...agg.entries()].sort((a, b) => b[1] - a[1]).map(([userId, points], i) => ({ userId, points, rank: i + 1 }))
}
function nameFor(uid) {
  return profileById.get(uid)?.display_name ?? pool1007.find(a => a.user_id === uid)?.player_name ?? uid
}

for (const [label, correctVal] of Object.entries(scenarios)) {
  const newRankFor1007 = orgRankFor(correctVal)
  const newRankByUser = new Map(newRankFor1007.map(r => [r.userId, r.rank]))

  // Bygg justerte season_scores-rader for JUST denne quizen (erstatt hele org-scopet
  // for 10.07 med nye rank/points; alle andre quizer i perioden er uendret).
  const adjustedMonthRows = orgSeasonRowsMonth.map(r => {
    if (r.quiz_id !== QUIZ_1007) return r
    const newRank = newRankByUser.get(r.user_id)
    return newRank ? { ...r, points: getPoints(newRank) } : r
  })

  const before = rankFromPoints(sumPointsByUser(orgSeasonRowsMonth))
  const after = rankFromPoints(sumPointsByUser(adjustedMonthRows))
  const beforeByUser = new Map(before.map(r => [r.userId, r]))

  console.log(`\n── ${label} ──`)
  const mortenBefore = before.find(r => r.userId === MORTEN_USER_ID)
  const mortenAfter = after.find(r => r.userId === MORTEN_USER_ID)
  console.log(`  Morten juli-total: ${mortenBefore?.points ?? 0} poeng (rank ${mortenBefore?.rank ?? '-'})  →  ${mortenAfter?.points ?? 0} poeng (rank ${mortenAfter?.rank ?? '-'})`)

  let changed = 0
  for (const r of after) {
    const b = beforeByUser.get(r.userId)
    if (!b || b.rank !== r.rank || b.points !== r.points) {
      changed++
      console.log(`    ENDRING: ${nameFor(r.userId).padEnd(28)} ${b?.points ?? 0} poeng (rank ${b?.rank ?? '-'}) -> ${r.points} poeng (rank ${r.rank})`)
    }
  }
  if (changed <= 1) console.log('    (kun Morten selv endres, ingen andre)')
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log('2) KVARTAL (Q3 2026 = juli-september) OG ÅR (2026) OG ALL-TIME')
console.log('══════════════════════════════════════════════════════════════')

const periods = {
  'Kvartal (Q3 2026, 01.07–30.09)': { start: '2026-07-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
  'År (2026)': { start: '2026-01-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' },
  'All-time': { start: '0000-01-01T00:00:00.000Z', end: null },
}

for (const [periodLabel, range] of Object.entries(periods)) {
  const rowsInPeriod = orgSeasonRowsAllTime.filter(s => s.closes_at >= range.start && (!range.end || s.closes_at < range.end))
  console.log(`\n── ${periodLabel} ── (${rowsInPeriod.length} season_scores-rader i org-scope for perioden, herav ${rowsInPeriod.filter(r => r.quiz_id === QUIZ_1007).length} fra 10.07-quizen)`)

  for (const [label, correctVal] of Object.entries(scenarios)) {
    const newRankFor1007 = orgRankFor(correctVal)
    const newRankByUser = new Map(newRankFor1007.map(r => [r.userId, r.rank]))
    const adjusted = rowsInPeriod.map(r => {
      if (r.quiz_id !== QUIZ_1007) return r
      const newRank = newRankByUser.get(r.user_id)
      return newRank ? { ...r, points: getPoints(newRank) } : r
    })
    const before = rankFromPoints(sumPointsByUser(rowsInPeriod))
    const after = rankFromPoints(sumPointsByUser(adjusted))
    const beforeByUser = new Map(before.map(r => [r.userId, r]))
    const mortenBefore = before.find(r => r.userId === MORTEN_USER_ID)
    const mortenAfter = after.find(r => r.userId === MORTEN_USER_ID)
    let changed = []
    for (const r of after) {
      const b = beforeByUser.get(r.userId)
      if (!b || b.rank !== r.rank || b.points !== r.points) changed.push({ uid: r.userId, before: b, after: r })
    }
    console.log(`  ${label}: Morten ${mortenBefore?.points ?? 0}p(#${mortenBefore?.rank ?? '-'}) -> ${mortenAfter?.points ?? 0}p(#${mortenAfter?.rank ?? '-'})   [${changed.length} bruker(e) med endret rank/poeng totalt]`)
  }
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log('3) SAMME SJEKK FOR GLOBAL SCOPE (er Morten global-blokkert?)')
console.log('══════════════════════════════════════════════════════════════')
const mortenOrgMembership = orgMembers.find(m => m.user_id === MORTEN_USER_ID && m.organization_id === elkjop.id)
console.log(`Mortens global_league_opt_out: ${mortenOrgMembership?.global_league_opt_out}`)
console.log(`Elkjøp Nordic allow_global_league: ${elkjop.allow_global_league}`)
const globalBlocked = mortenOrgMembership?.global_league_opt_out === true || elkjop.allow_global_league === false
console.log(globalBlocked
  ? '-> Morten er BLOKKERT fra global-scope season_scores for denne quizen (award-season-points hopper over global-rad for org-medlemmer med opt_out=true eller allow_global_league=false).'
  : '-> Morten er IKKE blokkert fra global scope — sjekker global season_scores-rad for 10.07:')

if (!globalBlocked) {
  const globalRow = seasonRows.find(s => s.scope_type === 'global' && s.user_id === MORTEN_USER_ID && s.quiz_id === QUIZ_1007)
  console.log(`   Global season_scores-rad for Morten pa 10.07: ${globalRow ? `rank=${globalRow.rank}, poeng=${globalRow.points}` : 'IKKE FUNNET'}`)
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log('4) HVA SER MORTEN KONKRET I APPEN, FØR OG ETTER?')
console.log('══════════════════════════════════════════════════════════════')
console.log('SeasonLeaderboard.tsx tilbyr 5 faner: Siste quiz / Måned / Kvartal / År / All-time.')
console.log('Disse er brukt på /org/[slug] (org-scope) og /toppliste (global-scope) — se tallene over.')

console.log('\n══════════════════════════════════════════════════════════════')
console.log('5) SAMME PERIODE-EFFEKT, GLOBAL SCOPE')
console.log('══════════════════════════════════════════════════════════════')

// Global-scope pool for 10.07: ALLE innloggede solo-forsøk (ikke org-filtrert),
// minus globalt blokkerte (opt_out=true eller org.allow_global_league=false).
const blockedGlobalUserIds = new Set()
for (const m of orgMembers) {
  const org = orgs.find(o => o.id === m.organization_id)
  if (m.global_league_opt_out === true || org?.allow_global_league === false) blockedGlobalUserIds.add(m.user_id)
}
const poolGlobal1007 = attempts.filter(a => a.quiz_id === QUIZ_1007 && !a.is_team && a.user_id && !blockedGlobalUserIds.has(a.user_id))
const mortenGlobalAttempt = poolGlobal1007.find(a => a.user_id === MORTEN_USER_ID)

function globalRankFor(overrideCorrect) {
  const best = new Map()
  for (const a of poolGlobal1007) {
    const v = a.id === mortenGlobalAttempt.id ? { ...a, correct_answers: overrideCorrect } : a
    const cur = best.get(a.user_id)
    if (!cur || compareAttempts(v, cur) < 0) best.set(a.user_id, v)
  }
  return rankSeason(best)
}

const globalSeasonRowsAllTime = seasonRows.filter(s => s.scope_type === 'global')

for (const [periodLabel, range] of Object.entries({
  'Måned (juli 2026)': { start: monthStart, end: monthEnd },
  'Kvartal (Q3 2026)': periods['Kvartal (Q3 2026, 01.07–30.09)'],
  'År (2026)': periods['År (2026)'],
  'All-time': periods['All-time'],
})) {
  const rowsInPeriod = globalSeasonRowsAllTime.filter(s => s.closes_at >= range.start && (!range.end || s.closes_at < range.end))
  console.log(`\n── ${periodLabel} ── (${rowsInPeriod.length} globale season_scores-rader i perioden)`)
  for (const [label, correctVal] of Object.entries(scenarios)) {
    const newRankFor1007 = globalRankFor(correctVal)
    const newRankByUser = new Map(newRankFor1007.map(r => [r.userId, r.rank]))
    const adjusted = rowsInPeriod.map(r => {
      if (r.quiz_id !== QUIZ_1007) return r
      const newRank = newRankByUser.get(r.user_id)
      return newRank ? { ...r, points: getPoints(newRank) } : r
    })
    const before = rankFromPoints(sumPointsByUser(rowsInPeriod))
    const after = rankFromPoints(sumPointsByUser(adjusted))
    const beforeByUser = new Map(before.map(r => [r.userId, r]))
    const mortenBefore = before.find(r => r.userId === MORTEN_USER_ID)
    const mortenAfter = after.find(r => r.userId === MORTEN_USER_ID)
    let changed = []
    for (const r of after) {
      const b = beforeByUser.get(r.userId)
      if (!b || b.rank !== r.rank || b.points !== r.points) changed.push(r.userId)
    }
    console.log(`  ${label}: Morten ${mortenBefore?.points ?? 0}p(#${mortenBefore?.rank ?? '-'}) -> ${mortenAfter?.points ?? 0}p(#${mortenAfter?.rank ?? '-'})   [${changed.length} bruker(e) endret totalt]`)
  }
}
