// ─────────────────────────────────────────────────────────────────────────────
// LØSER de 6 gjenværende duplikat-konfliktene med en MØNSTERBASERT REGEL.
//
// For hvert duplikatspørsmål: hvis paret matcher signaturen "feil svar brukte
// ≥70% av tidsgrensen, rett svar brukte ≤30%" — en klar feilklikk-rettet-opp-
// signatur — beholdes den RETTE raden. Ellers (tvetydig, omvendt rekkefølge,
// eller ingen korrekthet-konflikt i det hele tatt) faller vi tilbake til den
// konservative regelen: behold raden som gir LAVEST correct_answers (dvs. den
// FEILE, hvis det finnes én). Ved lik is_correct-verdi (ingen konflikt i det
// hele tatt) spiller valget ingen rolle for poengsum — behold laveste id.
//
// Berørte forsøk:
//   Morten Kristiansen Røed  (Fredagsquiz 10.07.2026) — 3 duplikatgrupper
//   Tiril Stenhammer         (Fredagsquiz 19.06.2026) — 2 duplikatgrupper
//   Håkon Lorentsen          (Fredagsquiz 26.06.2026) — 1 duplikatgruppe
//   Mari Tangvall Eggen      (Fredagsquiz 17.07.2026) — 1 duplikatgruppe
//   Magnus Rolstad           (Fredagsquiz 19.06.2026) — 1 duplikatgruppe
//   Elisabeth Sandberg Kvebek(Fredagsquiz 10.07.2026) — 1 duplikatgruppe
//
// ETTER sletting rekalkuleres correct_answers og correct_streak for disse
// forsøkene (samme metode — order_index-rekkefølge — som tidligere backfills).
// 'score' finnes IKKE som kolonne på attempts (bekreftet: PGRST204 ved forsøk
// på å skrive den) og røres derfor ikke — kun correct_answers og correct_streak.
//
// KJØRING:
//   node scripts/resolve-duplicate-conflicts.mjs           → DRY RUN
//   node scripts/resolve-duplicate-conflicts.mjs --apply   → skriver til databasen
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

function calculateStreak(rows) {
  let maxStreak = 0, cur = 0
  for (const a of rows) { if (a.is_correct) { cur++; maxStreak = Math.max(maxStreak, cur) } else cur = 0 }
  return maxStreak
}
function compareAttempts(a, b) {
  if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
  if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
  return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
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
const SEASON_POINTS = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]
const getPoints = rank => (rank <= 10 ? SEASON_POINTS[rank - 1] : 1)

console.log(APPLY
  ? '*** APPLY-MODUS — DETTE SLETTER RADER OG OPPDATERER attempts ***\n'
  : '=== DRY RUN — ingen skriving. Bruk --apply for a utfore. ===\n')

const TARGET_PLAYERS_BY_QUIZ = [
  { name: 'Morten Kristiansen Røed', quizMatch: '10.07' },
  { name: 'Tiril Stenhammer', quizMatch: '19.06' },
  { name: 'Håkon Lorentsen', quizMatch: '26.06' },
  { name: 'Mari Tangvall Eggen', quizMatch: '17.07' },
  { name: 'Magnus Rolstad', quizMatch: '19.06' },
  { name: 'Elisabeth Sandberg Kvebek', quizMatch: '10.07' },
]

const [questions, attempts, answers, quizzes, orgMembers, orgs, seasonRows] = await Promise.all([
  fetchAll('questions', 'id, quiz_id, order_index, time_limit_seconds'),
  fetchAll('attempts', 'id, quiz_id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, submitted_at'),
  fetchAll('attempt_answers', 'id, attempt_id, question_id, is_correct, selected_answer, time_ms'),
  fetchAll('quizzes', 'id, title, closes_at'),
  fetchAll('organization_members', 'user_id, organization_id, global_league_opt_out'),
  fetchAll('organizations', 'id, name, allow_global_league'),
  fetchAll('season_scores', 'id, user_id, quiz_id, scope_type, scope_id, points, rank, closes_at'),
])

const quizById = new Map(quizzes.map(q => [q.id, q]))
const qByQuiz = new Map()
for (const q of questions) { if (!qByQuiz.has(q.quiz_id)) qByQuiz.set(q.quiz_id, []); qByQuiz.get(q.quiz_id).push(q) }
for (const [, a] of qByQuiz) a.sort((x, y) => x.order_index - y.order_index)
const byAttempt = new Map()
for (const a of answers) { if (!byAttempt.has(a.attempt_id)) byAttempt.set(a.attempt_id, []); byAttempt.get(a.attempt_id).push(a) }
const orgMemberByUser = new Map()
for (const m of orgMembers) { if (!orgMemberByUser.has(m.user_id)) orgMemberByUser.set(m.user_id, []); orgMemberByUser.get(m.user_id).push(m) }
const orgById = new Map(orgs.map(o => [o.id, o]))

// ── Finn de eksakte forsøkene ────────────────────────────────────────────────
const targetAttempts = []
for (const t of TARGET_PLAYERS_BY_QUIZ) {
  const quiz = quizzes.find(q => q.title.includes(t.quizMatch))
  const at = attempts.find(a => a.quiz_id === quiz.id && a.player_name === t.name && a.submitted_at)
  if (!at) { console.log(`ADVARSEL: fant ikke ${t.name} pa quiz ${t.quizMatch}`); continue }
  targetAttempts.push(at)
}

// ── Mønsterbasert regel ──────────────────────────────────────────────────────
// "Feilklikk rettet opp": den FEILE raden brukte ≥70% av tidsgrensen (spilleren
// slet/gjettet i siste liten) OG den RETTE raden var raskt avgitt (≤30% av
// grensen). Dette er den eneste signaturen vi har rimelig grunn til å tolke
// kausalt (sent+feil, så gjenopptak, så raskt+riktig — se tidligere "Rådata"-
// analyse av Morten sitt spørsmål #9). Alt annet — omvendt rekkefølge, eller
// verdier som ikke tydelig skiller seg — er ikke til å skille fra tilfeldig
// støy, og faller tilbake til den konservative regelen.
const PATTERN_WRONG_MIN_PCT = 0.70
const PATTERN_RIGHT_MAX_PCT = 0.30

function matchesFatFingerPattern(wrong, right, limitMs) {
  if (!limitMs) return false
  return (wrong.time_ms / limitMs) >= PATTERN_WRONG_MIN_PCT
      && (right.time_ms / limitMs) <= PATTERN_RIGHT_MAX_PCT
}

console.log(`== FASE 1 — identifiser duplikatgrupper (monsterbasert regel) ==\n`)
const plan = [] // { attempt, quiz, quizQuestions, deletes: [row], keptGrade: Map(qid -> is_correct) }
for (const at of targetAttempts) {
  const quiz = quizById.get(at.quiz_id)
  const quizQ = qByQuiz.get(at.quiz_id) ?? []
  const rows = byAttempt.get(at.id) ?? []
  const perQ = new Map()
  for (const r of rows) { if (!perQ.has(r.question_id)) perQ.set(r.question_id, []); perQ.get(r.question_id).push(r) }

  const deletes = []
  const keptGrade = new Map()
  console.log(`${at.player_name}  (${quiz.title})`)
  for (const [qid, list] of perQ) {
    keptGrade.set(qid, list[0].is_correct) // default hvis ingen duplikat
    if (list.length < 2) continue

    const q = quizQ.find(q => q.id === qid)
    const limitMs = (q?.time_limit_seconds ?? 10) * 1000
    const wrongRows = list.filter(r => !r.is_correct)
    const rightRows = list.filter(r => r.is_correct)

    let keep, drop, ruleLabel
    if (wrongRows.length === 1 && rightRows.length === 1 && matchesFatFingerPattern(wrongRows[0], rightRows[0], limitMs)) {
      keep = rightRows[0]
      drop = [wrongRows[0]]
      ruleLabel = `MONSTER (feil ${(wrongRows[0].time_ms / limitMs * 100).toFixed(1)}% av grense, rett ${(rightRows[0].time_ms / limitMs * 100).toFixed(1)}%)`
    } else {
      // Konservativ regel: foretrekk is_correct=false (lavest correct_answers-bidrag).
      // Ved lik is_correct: laveste id (deterministisk).
      const sorted = [...list].sort((a, b) => {
        if (a.is_correct !== b.is_correct) return a.is_correct ? 1 : -1 // false forst
        return a.id.localeCompare(b.id)
      })
      keep = sorted[0]
      drop = sorted.slice(1)
      ruleLabel = wrongRows.length === 1 && rightRows.length === 1
        ? `KONSERVATIV (matcher ikke monster: feil ${(wrongRows[0].time_ms / limitMs * 100).toFixed(1)}%, rett ${(rightRows[0].time_ms / limitMs * 100).toFixed(1)}%)`
        : 'KONSERVATIV (ingen korrekthet-konflikt eller >2 rader)'
    }

    keptGrade.set(qid, keep.is_correct)
    deletes.push(...drop)
    console.log(`   sporsmal #${q?.order_index}: ${list.length} rader → [${ruleLabel}] beholder svar=${JSON.stringify(keep.selected_answer)} ${keep.is_correct ? 'rett' : 'feil'} (${keep.time_ms}ms), sletter ${drop.length}`)
  }

  const recomputedCorrect = [...keptGrade.values()].filter(Boolean).length
  const recomputedStreak = calculateStreak(quizQ.map(q => ({ is_correct: keptGrade.get(q.id) === true })))
  plan.push({ at, quiz, quizQ, deletes, keptGrade, recomputedCorrect, recomputedStreak })
  console.log(`   correct_answers: lagret=${at.correct_answers} → ${recomputedCorrect}`)
  console.log(`   correct_streak:  lagret=${at.correct_streak} → ${recomputedStreak}\n`)
}

const totalDeletes = plan.reduce((s, p) => s + p.deletes.length, 0)
console.log(`Totalt rader som slettes: ${totalDeletes}`)
console.log(`Forsok som far correct_answers/correct_streak oppdatert: ${plan.length}\n`)

// ── FASE 2 — rangeringseffekt: quiz-leaderboard ─────────────────────────────
console.log(`== FASE 2 — quiz-leaderboard (per quiz) ==\n`)
const newValsByAttemptId = new Map(plan.map(p => [p.at.id, { correct_answers: p.recomputedCorrect, correct_streak: p.recomputedStreak }]))

for (const p of plan) {
  const room = attempts.filter(a => a.quiz_id === p.at.quiz_id && a.is_team === p.at.is_team)
  const before = rankQuizAttempts(room)
  const after = rankQuizAttempts(room.map(a => newValsByAttemptId.has(a.id) ? { ...a, ...newValsByAttemptId.get(a.id) } : a))
  const afterRank = new Map(after.map(r => [r.id, r.rank]))
  const beforeEntry = before.find(r => r.id === p.at.id)
  const afterR = afterRank.get(p.at.id)
  console.log(`${p.at.player_name} (${p.quiz.title}): rank ${beforeEntry?.rank ?? '(utenfor)'} → ${afterR ?? '(utenfor)'}`)
  let anyOtherChange = false
  for (const r of before) {
    if (r.id === p.at.id) continue
    if (afterRank.get(r.id) !== r.rank) {
      anyOtherChange = true
      console.log(`   ANDRE PAVIRKET: ${r.player_name} ${r.rank} → ${afterRank.get(r.id)}`)
    }
  }
  if (!anyOtherChange) console.log('   (ingen andre spilleres plassering pavirket)')
}

// ── FASE 3 — season_scores: quiz-spesifikk rank/poeng, global + org ─────────
console.log(`\n== FASE 3 — season_scores (quiz-spesifikk rank/poeng) ==\n`)

function seasonImpactForScope(p, scopeType, scopeId, poolFilterFn) {
  const pool = attempts.filter(a => a.quiz_id === p.at.quiz_id && !a.is_team && a.user_id && poolFilterFn(a.user_id))
  const build = (overrideId, vals) => {
    const best = new Map()
    for (const a of pool) {
      const v = a.id === overrideId ? { ...a, ...vals } : a
      const cur = best.get(a.user_id)
      if (!cur || compareAttempts(v, cur) < 0) best.set(a.user_id, v)
    }
    return best
  }
  const before = rankSeason(build(null, {}))
  const after = rankSeason(build(p.at.id, { correct_answers: p.recomputedCorrect, correct_streak: p.recomputedStreak }))
  const beforeMap = new Map(before.map(r => [r.userId, r.rank]))
  const afterMap = new Map(after.map(r => [r.userId, r.rank]))
  const changes = []
  for (const [uid, rb] of beforeMap) {
    const ra = afterMap.get(uid)
    if (ra !== rb) changes.push({ uid, rb, ra })
  }
  return { changes, before, after }
}

// MERK: "globalt blokkert" (opt_out / allow_global_league=false) styrer i
// lib/award-season-points.ts KUN hvilke RADER som skrives til season_scores —
// selve rangeringen kjøres FØRST over HELE populasjonen
// (`rankBestAttempts(bestByUser)`, ufiltrert), og filteret på blokkerte
// brukere anvendes ETTERPÅ, kun på hvilke rader som lagres. En blokkert
// bruker opptar altså fortsatt en rank-plass for alle andre, selv om de selv
// aldri får en skreven rad. Rangeringspoolen her må derfor speile DEN FULLE
// populasjonen (uid => true) — IKKE ekskludere blokkerte brukere — ellers
// forskyves rank-tallet for alle ikke-blokkerte brukere feilaktig. At en
// bruker er blokkert reflekteres allerede i at de ikke HAR en global
// season_scores-rad i utgangspunktet.
for (const p of plan) {
  if (!p.at.user_id) { console.log(`${p.at.player_name}: gjest, ingen season_scores.\n`); continue }
  console.log(`${p.at.player_name} (${p.quiz.title}):`)

  const globalRes = seasonImpactForScope(p, 'global', null, () => true)
  const globalStoredRow = seasonRows.find(s => s.quiz_id === p.at.quiz_id && s.scope_type === 'global' && s.user_id === p.at.user_id)
  console.log(`   GLOBAL: lagret rank=${globalStoredRow?.rank ?? '(ingen rad)'} poeng=${globalStoredRow?.points ?? '-'}`)
  if (globalRes.changes.length === 0) console.log('   GLOBAL: ingen rank-endring for noen')
  else for (const c of globalRes.changes) console.log(`   GLOBAL ENDRING: bruker ${c.uid.slice(0,8)}... rank ${c.rb} → ${c.ra}`)

  const memberships = orgMemberByUser.get(p.at.user_id) ?? []
  for (const m of memberships) {
    const org = orgById.get(m.organization_id)
    const orgMemberIds = new Set(orgMembers.filter(x => x.organization_id === m.organization_id).map(x => x.user_id))
    const orgRes = seasonImpactForScope(p, 'organization', m.organization_id, uid => orgMemberIds.has(uid))
    const orgStoredRow = seasonRows.find(s => s.quiz_id === p.at.quiz_id && s.scope_type === 'organization' && s.scope_id === m.organization_id && s.user_id === p.at.user_id)
    console.log(`   ORG (${org?.name}): lagret rank=${orgStoredRow?.rank ?? '(ingen rad)'} poeng=${orgStoredRow?.points ?? '-'}`)
    if (orgRes.changes.length === 0) console.log(`   ORG (${org?.name}): ingen rank-endring for noen`)
    else for (const c of orgRes.changes) console.log(`   ORG (${org?.name}) ENDRING: bruker ${c.uid.slice(0,8)}... rank ${c.rb} → ${c.ra}`)
  }
  console.log('')
}

// ── FASE 4 — periode-aggregater (måned/kvartal/år/all-time), global + org ──
console.log(`== FASE 4 — periode-aggregater (kun for spillere med minst én rank-endring over) ==\n`)

// Speiler /api/toppliste sin JS-fallback-sortering NØYAKTIG (linje ~539-543):
// poeng DESC, antall quizer ASC, user_id ASC. Uten disse tiebreakerne er
// rekkefølgen blant de MANGE brukerne med likt poengtall (svært vanlig tidlig i
// en sesong) vilkårlig og varierer tilfeldig mellom to kjøringer — det ville gitt
// falske "endringer" for spillere som aldri faktisk endret plassering.
function sumPointsByUser(rows) {
  const agg = new Map()
  for (const r of rows) {
    const e = agg.get(r.user_id) ?? { points: 0, quizCount: 0 }
    e.points += r.points
    e.quizCount += 1
    agg.set(r.user_id, e)
  }
  return agg
}
function rankFromPoints(agg) {
  const sorted = [...agg.entries()].sort((a, b) => {
    if (b[1].points !== a[1].points) return b[1].points - a[1].points
    if (a[1].quizCount !== b[1].quizCount) return a[1].quizCount - b[1].quizCount
    return a[0].localeCompare(b[0])
  })
  return sorted.map(([userId, e], i) => ({ userId, points: e.points, rank: i + 1 }))
}
function getPeriodRanges(closesAtIso) {
  const d = new Date(closesAtIso)
  const y = d.getUTCFullYear(), m = d.getUTCMonth()
  const q = Math.floor(m / 3)
  return {
    'Måned': { start: new Date(Date.UTC(y, m, 1)).toISOString(), end: new Date(Date.UTC(y, m + 1, 1)).toISOString() },
    'Kvartal': { start: new Date(Date.UTC(y, q * 3, 1)).toISOString(), end: new Date(Date.UTC(y, (q + 1) * 3, 1)).toISOString() },
    'Ar': { start: new Date(Date.UTC(y, 0, 1)).toISOString(), end: new Date(Date.UTC(y + 1, 0, 1)).toISOString() },
    'All-time': { start: '0000-01-01T00:00:00.000Z', end: null },
  }
}

for (const p of plan) {
  if (!p.at.user_id) continue
  const ranges = getPeriodRanges(p.quiz.closes_at)

  // Global
  const globalRowsAll = seasonRows.filter(s => s.scope_type === 'global')
  for (const [label, range] of Object.entries(ranges)) {
    const rowsInPeriod = globalRowsAll.filter(s => s.closes_at >= range.start && (!range.end || s.closes_at < range.end))
    if (rowsInPeriod.length === 0) continue
    const before = rankFromPoints(sumPointsByUser(rowsInPeriod))
    const globalRes = seasonImpactForScope(p, 'global', null, () => true)
    const newRankByUser = new Map(globalRes.after.map(r => [r.userId, r.rank]))
    const adjusted = rowsInPeriod.map(r => {
      if (r.quiz_id !== p.at.quiz_id) return r
      const nr = newRankByUser.get(r.user_id)
      return nr ? { ...r, points: getPoints(nr) } : r
    })
    const after = rankFromPoints(sumPointsByUser(adjusted))
    const beforeMap = new Map(before.map(r => [r.userId, r]))
    const changed = after.filter(r => { const b = beforeMap.get(r.userId); return !b || b.rank !== r.rank || b.points !== r.points })
    const meBefore = before.find(r => r.userId === p.at.user_id)
    const meAfter = after.find(r => r.userId === p.at.user_id)
    if ((meBefore?.points ?? 0) !== (meAfter?.points ?? 0) || changed.length > 0) {
      console.log(`${p.at.player_name} — GLOBAL ${label}: ${meBefore?.points ?? 0}p(#${meBefore?.rank ?? '-'}) → ${meAfter?.points ?? 0}p(#${meAfter?.rank ?? '-'})  [${changed.length} bruker(e) endret totalt]`)
    }
  }

  // Org
  const memberships = orgMemberByUser.get(p.at.user_id) ?? []
  for (const m of memberships) {
    const org = orgById.get(m.organization_id)
    const orgMemberIds = new Set(orgMembers.filter(x => x.organization_id === m.organization_id).map(x => x.user_id))
    const orgRowsAll = seasonRows.filter(s => s.scope_type === 'organization' && s.scope_id === m.organization_id)
    for (const [label, range] of Object.entries(ranges)) {
      const rowsInPeriod = orgRowsAll.filter(s => s.closes_at >= range.start && (!range.end || s.closes_at < range.end))
      if (rowsInPeriod.length === 0) continue
      const before = rankFromPoints(sumPointsByUser(rowsInPeriod))
      const orgRes = seasonImpactForScope(p, 'organization', m.organization_id, uid => orgMemberIds.has(uid))
      const newRankByUser = new Map(orgRes.after.map(r => [r.userId, r.rank]))
      const adjusted = rowsInPeriod.map(r => {
        if (r.quiz_id !== p.at.quiz_id) return r
        const nr = newRankByUser.get(r.user_id)
        return nr ? { ...r, points: getPoints(nr) } : r
      })
      const after = rankFromPoints(sumPointsByUser(adjusted))
      const beforeMap = new Map(before.map(r => [r.userId, r]))
      const changed = after.filter(r => { const b = beforeMap.get(r.userId); return !b || b.rank !== r.rank || b.points !== r.points })
      const meBefore = before.find(r => r.userId === p.at.user_id)
      const meAfter = after.find(r => r.userId === p.at.user_id)
      if ((meBefore?.points ?? 0) !== (meAfter?.points ?? 0) || changed.length > 0) {
        console.log(`${p.at.player_name} — ORG(${org?.name}) ${label}: ${meBefore?.points ?? 0}p(#${meBefore?.rank ?? '-'}) → ${meAfter?.points ?? 0}p(#${meAfter?.rank ?? '-'})  [${changed.length} bruker(e) endret totalt]`)
      }
    }
  }
}

if (!APPLY) {
  console.log('\n=== DRY RUN FERDIG — ingenting ble skrevet. ===')
  process.exit(0)
}

// ── FASE 5 — utforelse ──────────────────────────────────────────────────────
console.log('\n== FASE 5 — SKRIVER TIL DATABASEN ==')

let deleted = 0
const allDeleteIds = plan.flatMap(p => p.deletes.map(r => r.id))
for (let i = 0; i < allDeleteIds.length; i += 100) {
  const chunk = allDeleteIds.slice(i, i + 100)
  const { error } = await sb.from('attempt_answers').delete().in('id', chunk)
  if (error) { console.error('   DELETE FEILET:', error.message); process.exit(1) }
  deleted += chunk.length
  console.log(`   slettet ${deleted}/${allDeleteIds.length} rader`)
}

let updated = 0
for (const p of plan) {
  const { error } = await sb.from('attempts')
    .update({ correct_answers: p.recomputedCorrect, correct_streak: p.recomputedStreak })
    .eq('id', p.at.id)
  if (error) { console.error(`   UPDATE FEILET for ${p.at.player_name}:`, error.message); process.exit(1) }
  updated++
  console.log(`   ${p.at.player_name}: correct_answers ${p.at.correct_answers} → ${p.recomputedCorrect}, correct_streak ${p.at.correct_streak} → ${p.recomputedStreak}`)
}

console.log(`\n== FERDIG ==`)
console.log(`   attempt_answers-rader slettet: ${deleted}`)
console.log(`   attempts oppdatert:            ${updated}`)
