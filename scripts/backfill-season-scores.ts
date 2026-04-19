// Backfill sesongpoeng for alle historiske quizer
//
// Kjøres med:
//   npx tsx scripts/backfill-season-scores.ts
//
// Krever følgende miljøvariabler (leses automatisk fra .env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Scriptet er idempotent: kan kjøres flere ganger uten å doble poeng.
// Quizer som allerede er markert season_points_awarded=true hoppes over.
// For å rebehandle en quiz: sett season_points_awarded=false i Supabase
// og kjør scriptet igjen — ON CONFLICT DO NOTHING beskytter mot dobling.

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

// Last .env.local automatisk
try {
  const envContent = readFileSync(join(process.cwd(), '.env.local'), 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !process.env[key]) process.env[key] = val
  }
} catch {
  // .env.local ikke funnet — forventer at env-variabler er satt eksplisitt
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Mangler NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Delte hjelpefunksjoner ────────────────────────────────────────────────────

const POINTS_TABLE = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]

function getPoints(rank: number): number {
  return rank <= 10 ? POINTS_TABLE[rank - 1] : 1
}

type RawAttempt = {
  user_id: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
}

function pickBestAttempt(a: RawAttempt, b: RawAttempt): RawAttempt {
  if (b.correct_answers > a.correct_answers) return b
  if (b.correct_answers === a.correct_answers && b.total_time_ms < a.total_time_ms) return b
  if (
    b.correct_answers === a.correct_answers &&
    b.total_time_ms === a.total_time_ms &&
    (b.correct_streak ?? 0) > (a.correct_streak ?? 0)
  ) return b
  return a
}

type Ranked = { userId: string; rank: number }

function rankBestAttempts(bestByUser: Map<string, RawAttempt>): Ranked[] {
  const sorted = [...bestByUser.entries()].sort(([, a], [, b]) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
    return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  })
  const result: Ranked[] = []
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

type ScoreRow = {
  user_id: string
  quiz_id: string
  scope_type: string
  scope_id: string | null
  points: number
  rank: number
  closes_at: string
}

async function upsertScores(rows: ScoreRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase
    .from('season_scores')
    .upsert(rows, {
      onConflict: 'user_id,quiz_id,scope_type,scope_id',
      ignoreDuplicates: true,
    })
  if (error) throw new Error(`upsert feilet: ${error.message}`)
}

// ── Behandle én quiz ──────────────────────────────────────────────────────────

async function processQuiz(quizId: string, closesAt: string): Promise<number> {
  const { data: rawAttempts, error: attError } = await supabase
    .from('attempts')
    .select('user_id, correct_answers, total_time_ms, correct_streak')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)

  if (attError) throw new Error(attError.message)

  if (!rawAttempts || rawAttempts.length === 0) {
    await supabase.from('quizzes').update({ season_points_awarded: true }).eq('id', quizId)
    return 0
  }

  const bestByUser = new Map<string, RawAttempt>()
  for (const a of rawAttempts as RawAttempt[]) {
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) : a)
  }

  const userIds = [...bestByUser.keys()]
  let totalRows = 0

  // Global
  const globalRanked = rankBestAttempts(bestByUser)
  const globalRows: ScoreRow[] = globalRanked.map(({ userId, rank }) => ({
    user_id: userId,
    quiz_id: quizId,
    scope_type: 'global',
    scope_id: null,
    points: getPoints(rank),
    rank,
    closes_at: closesAt,
  }))
  await upsertScores(globalRows)
  totalRows += globalRows.length

  // Liga
  const { data: leagueMemberships } = await supabase
    .from('league_members')
    .select('league_id, user_id')
    .in('user_id', userIds)

  if (leagueMemberships && leagueMemberships.length > 0) {
    const byLeague = new Map<string, string[]>()
    for (const lm of leagueMemberships as { league_id: string; user_id: string }[]) {
      if (!byLeague.has(lm.league_id)) byLeague.set(lm.league_id, [])
      byLeague.get(lm.league_id)!.push(lm.user_id)
    }
    for (const [leagueId, memberIds] of byLeague) {
      const leagueBest = new Map<string, RawAttempt>()
      for (const uid of memberIds) {
        const a = bestByUser.get(uid)
        if (a) leagueBest.set(uid, a)
      }
      if (leagueBest.size === 0) continue
      const rows: ScoreRow[] = rankBestAttempts(leagueBest).map(({ userId, rank }) => ({
        user_id: userId,
        quiz_id: quizId,
        scope_type: 'league',
        scope_id: leagueId,
        points: getPoints(rank),
        rank,
        closes_at: closesAt,
      }))
      await upsertScores(rows)
      totalRows += rows.length
    }
  }

  // Org
  const { data: orgMemberships } = await supabase
    .from('organization_members')
    .select('organization_id, user_id')
    .in('user_id', userIds)

  if (orgMemberships && orgMemberships.length > 0) {
    const byOrg = new Map<string, string[]>()
    for (const om of orgMemberships as { organization_id: string; user_id: string }[]) {
      if (!byOrg.has(om.organization_id)) byOrg.set(om.organization_id, [])
      byOrg.get(om.organization_id)!.push(om.user_id)
    }
    for (const [orgId, memberIds] of byOrg) {
      const orgBest = new Map<string, RawAttempt>()
      for (const uid of memberIds) {
        const a = bestByUser.get(uid)
        if (a) orgBest.set(uid, a)
      }
      if (orgBest.size === 0) continue
      const rows: ScoreRow[] = rankBestAttempts(orgBest).map(({ userId, rank }) => ({
        user_id: userId,
        quiz_id: quizId,
        scope_type: 'organization',
        scope_id: orgId,
        points: getPoints(rank),
        rank,
        closes_at: closesAt,
      }))
      await upsertScores(rows)
      totalRows += rows.length
    }
  }

  // Marker som ferdig — settes ETTER alle inserts
  const { error: flagError } = await supabase
    .from('quizzes')
    .update({ season_points_awarded: true })
    .eq('id', quizId)

  if (flagError) {
    console.error(`  ADVARSEL: Klarte ikke sette season_points_awarded: ${flagError.message}`)
  }

  return totalRows
}

// ── Hovedprogram ──────────────────────────────────────────────────────────────

async function main() {
  const now = new Date().toISOString()

  const { data: quizzes, error: quizError } = await supabase
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .order('closes_at', { ascending: true })

  if (quizError) {
    console.error('Feil ved henting av quizer:', quizError.message)
    process.exit(1)
  }

  const total = quizzes?.length ?? 0
  if (total === 0) {
    console.log('Ingen quizer å behandle. Alt er allerede markert som ferdig.')
    return
  }

  console.log(`Fant ${total} quiz(er) å backfylle.\n`)

  let grandTotal = 0
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < total; i++) {
    const quiz = (quizzes as { id: string; title: string; closes_at: string }[])[i]
    process.stdout.write(`[${i + 1}/${total}] "${quiz.title}" ... `)
    try {
      const rows = await processQuiz(quiz.id, quiz.closes_at)
      grandTotal += rows
      succeeded++
      console.log(`${rows} rader skrevet`)
    } catch (err) {
      failed++
      console.error(`FEIL: ${(err as Error).message}`)
    }
  }

  console.log(`\nFerdig.`)
  console.log(`  Behandlet: ${succeeded}/${total}`)
  if (failed > 0) console.log(`  Feilet:    ${failed}`)
  console.log(`  Totalt antall rader skrevet: ${grandTotal}`)
}

main().catch(err => {
  console.error('Uventet feil:', err)
  process.exit(1)
})
