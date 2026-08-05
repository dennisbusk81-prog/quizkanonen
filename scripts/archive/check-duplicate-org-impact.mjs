// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY: sjekker org-tilknytning og org-scope season_scores-effekt for de
// 6 gjenstaende duplikat-forsokene (genuint ulikt svar, ikke ryddet ennaa).
//
// Skriver ALDRI til databasen.
//   node scripts/check-duplicate-org-impact.mjs
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

const TARGET_NAMES = [
  'Morten Kristiansen Røed', 'Tiril Stenhammer', 'Håkon Lorentsen',
  'Mari Tangvall Eggen', 'Magnus Rolstad', 'Elisabeth Sandberg Kvebek',
]

function compareAttempts(a, b) {
  if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
  if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
  const sd = (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  if (sd !== 0) return sd
  return a.id.localeCompare(b.id)
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
const POINTS = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]
const pts = r => (r <= 10 ? POINTS[r - 1] : 1)

const [attempts, answers, questions, quizzes, orgMembers, orgs, seasonRows, profiles] = await Promise.all([
  fetchAll('attempts', 'id, quiz_id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, submitted_at'),
  fetchAll('attempt_answers', 'id, attempt_id, question_id, is_correct, selected_answer, time_ms'),
  fetchAll('questions', 'id, quiz_id, order_index, time_limit_seconds'),
  fetchAll('quizzes', 'id, title, closes_at, time_limit_seconds'),
  fetchAll('organization_members', 'user_id, organization_id, global_league_opt_out'),
  fetchAll('organizations', 'id, name, allow_global_league'),
  fetchAll('season_scores', 'id, user_id, quiz_id, scope_type, scope_id, points, rank'),
  fetchAll('profiles', 'id, display_name'),
])

const orgById = new Map(orgs.map(o => [o.id, o]))
const quizById = new Map(quizzes.map(q => [q.id, q]))
const profileById = new Map(profiles.map(p => [p.id, p]))
const qByQuiz = new Map()
for (const q of questions) { if (!qByQuiz.has(q.quiz_id)) qByQuiz.set(q.quiz_id, []); qByQuiz.get(q.quiz_id).push(q) }
for (const [, a] of qByQuiz) a.sort((x, y) => x.order_index - y.order_index)
const byAttempt = new Map()
for (const a of answers) { if (!byAttempt.has(a.attempt_id)) byAttempt.set(a.attempt_id, []); byAttempt.get(a.attempt_id).push(a) }

// Speiler lib/ranking.ts calculateStreak
function calculateStreak(rows) {
  let maxStreak = 0, cur = 0
  for (const a of rows) { if (a.is_correct) { cur++; maxStreak = Math.max(maxStreak, cur) } else cur = 0 }
  return maxStreak
}

const targets = attempts.filter(a => TARGET_NAMES.includes(a.player_name))

console.log('══════════════════════════════════════════════════════════════')
console.log('1) ORG-TILKNYTNING FOR DE 6')
console.log('══════════════════════════════════════════════════════════════\n')

const orgMemberByUser = new Map()
for (const m of orgMembers) {
  if (!orgMemberByUser.has(m.user_id)) orgMemberByUser.set(m.user_id, [])
  orgMemberByUser.get(m.user_id).push(m)
}

const relevantOrgUsers = new Set()
for (const at of targets) {
  const memberships = at.user_id ? (orgMemberByUser.get(at.user_id) ?? []) : []
  console.log(`${at.player_name.padEnd(28)} quiz=${(quizById.get(at.quiz_id)?.title ?? '').padEnd(24)} user_id=${at.user_id ?? '(gjest)'}`)
  if (!at.user_id) {
    console.log('   -> GJEST, ikke tilknyttet noen bruker-id. Ingen org-medlemskap mulig.\n')
    continue
  }
  if (memberships.length === 0) {
    console.log('   -> Ikke medlem av noen organisasjon.\n')
    continue
  }
  for (const m of memberships) {
    const org = orgById.get(m.organization_id)
    console.log(`   -> Medlem av: ${org?.name ?? m.organization_id}  (opt_out=${m.global_league_opt_out === true}, org.allow_global_league=${org?.allow_global_league})`)
    relevantOrgUsers.add(at.user_id)
  }
  console.log('')
}

console.log('══════════════════════════════════════════════════════════════')
console.log('2) VILLE EN RETTING ENDRET NOENS PLASSERING PÅ ORG-TOPPLISTEN?')
console.log('══════════════════════════════════════════════════════════════\n')

if (relevantOrgUsers.size === 0) {
  console.log('Ingen av de 6 er medlem av noen organisasjon. Ingen org-scope å sjekke.\n')
} else {
  // For hvert berørt forsøk: bygg BEGGE mulige korrigerte varianter (behold rad
  // A vs. behold rad B for den uenige gruppen) og se om noen org-rangering endres
  // i NOEN av de to variantene sammenlignet med dagens (upåvirkede) tall.
  for (const at of targets) {
    if (!at.user_id || !relevantOrgUsers.has(at.user_id)) continue
    const quizQ = qByQuiz.get(at.quiz_id) ?? []
    if (quizQ.length !== at.total_questions) {
      console.log(`${at.player_name}: quizens spørsmålssett har endret seg — kan ikke rekonstruere trygt, hopper over.\n`)
      continue
    }
    const rows = byAttempt.get(at.id) ?? []
    const byQ = new Map()
    for (const r of rows) { if (!byQ.has(r.question_id)) byQ.set(r.question_id, []); byQ.get(r.question_id).push(r) }

    // Bygg to varianter: "forste" (laveste id per gruppe) og "andre" (hoyeste id)
    function buildVariant(pick) {
      const grade = new Map()
      for (const [qid, list] of byQ) {
        const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id))
        const chosen = pick === 'first' ? sorted[0] : sorted[sorted.length - 1]
        grade.set(qid, chosen.is_correct)
      }
      const correct = [...grade.values()].filter(Boolean).length
      const streak = calculateStreak(quizQ.map(q => ({ is_correct: grade.get(q.id) === true })))
      return { correct, streak }
    }
    const variantFirst = buildVariant('first')
    const variantSecond = buildVariant('second')

    console.log(`${at.player_name}  (${quizById.get(at.quiz_id)?.title})`)
    console.log(`   Lagret i dag:      correct_answers=${at.correct_answers}, streak=${at.correct_streak}`)
    console.log(`   Variant "rad A":   correct_answers=${variantFirst.correct}, streak=${variantFirst.streak}`)
    console.log(`   Variant "rad B":   correct_answers=${variantSecond.correct}, streak=${variantSecond.streak}`)

    const memberships = orgMemberByUser.get(at.user_id) ?? []
    for (const m of memberships) {
      const org = orgById.get(m.organization_id)
      // org-scope er uavhengig av allow_global_league/opt_out (den regelen gjelder
      // kun GLOBAL-raden i award-season-points) — org-scope beregnes alltid for
      // org-medlemmer.
      const orgMemberIds = orgMembers.filter(x => x.organization_id === m.organization_id).map(x => x.user_id)
      const pool = attempts.filter(a => a.quiz_id === at.quiz_id && !a.is_team && a.user_id && orgMemberIds.includes(a.user_id))

      function rankInOrg(overrideId, correct, streak) {
        const best = new Map()
        for (const a of pool) {
          const v = a.id === overrideId ? { ...a, correct_answers: correct, correct_streak: streak } : a
          const cur = best.get(a.user_id)
          if (!cur || compareAttempts(v, cur) < 0) best.set(a.user_id, v)
        }
        return rankSeason(best)
      }

      const baseline = rankInOrg(null, at.correct_answers, at.correct_streak)
      const withFirst = rankInOrg(at.id, variantFirst.correct, variantFirst.streak)
      const withSecond = rankInOrg(at.id, variantSecond.correct, variantSecond.streak)

      const baseMap = new Map(baseline.map(r => [r.userId, r.rank]))
      const cmpMap = (variant, label) => {
        let changed = 0
        for (const r of variant) {
          const before = baseMap.get(r.userId)
          if (before !== r.rank) {
            changed++
            const nm = profileById.get(r.userId)?.display_name ?? pool.find(a => a.user_id === r.userId)?.player_name ?? r.userId
            console.log(`      [${org?.name}] ${label}: ${nm} rank ${before} -> ${r.rank} (poeng ${pts(before)} -> ${pts(r.rank)})`)
          }
        }
        return changed
      }
      const c1 = cmpMap(withFirst, 'rad A')
      const c2 = cmpMap(withSecond, 'rad B')
      if (c1 === 0 && c2 === 0) {
        console.log(`      [${org?.name}] Ingen org-rangeringsendring i noen av variantene (org har ${pool.length} berørte medlemsforsøk på denne quizen).`)
      }

      // Faktisk lagret season_scores for org-scope på denne quizen
      const storedOrgRows = seasonRows.filter(s => s.quiz_id === at.quiz_id && s.scope_type === 'organization' && s.scope_id === m.organization_id)
      const storedForPlayer = storedOrgRows.find(s => s.user_id === at.user_id)
      if (storedForPlayer) {
        console.log(`      [${org?.name}] Lagret season_scores i dag: rank=${storedForPlayer.rank}, poeng=${storedForPlayer.points}`)
      } else {
        console.log(`      [${org?.name}] Ingen season_scores-rad funnet for denne spilleren i dette scopet (kanskje ikke tildelt ennå, eller blokkert).`)
      }
    }
    console.log('')
  }
}

console.log('══════════════════════════════════════════════════════════════')
console.log('3) ER NOEN AV DE 6 I TOPP 3 FOR NOEN ORG-SCOPE?')
console.log('══════════════════════════════════════════════════════════════\n')

let anyTop3 = false
for (const at of targets) {
  if (!at.user_id) continue
  const memberships = orgMemberByUser.get(at.user_id) ?? []
  for (const m of memberships) {
    const org = orgById.get(m.organization_id)
    const row = seasonRows.find(s => s.quiz_id === at.quiz_id && s.scope_type === 'organization' && s.scope_id === m.organization_id && s.user_id === at.user_id)
    if (row && row.rank <= 3) {
      anyTop3 = true
      console.log(`${at.player_name} er i TOPP 3 for org "${org?.name}" på quiz "${quizById.get(at.quiz_id)?.title}": rank ${row.rank}, poeng ${row.points}`)
    }
  }
}
if (!anyTop3) console.log('Ingen av de 6 er i topp 3 for noen org-scope (season_scores).')
