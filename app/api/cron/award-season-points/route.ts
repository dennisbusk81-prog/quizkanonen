import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const POINTS_TABLE = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1]
const BATCH_SIZE = 10

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
  const { error } = await supabaseAdmin
    .from('season_scores')
    .upsert(rows, {
      onConflict: 'user_id,quiz_id,scope_type,scope_id',
      ignoreDuplicates: true,
    })
  if (error) throw error
}

async function processQuiz(
  quizId: string,
  closesAt: string
): Promise<{ rows: number; error: string | null }> {
  // Hent alle solo innloggede forsøk for quizen
  const { data: rawAttempts, error: attError } = await supabaseAdmin
    .from('attempts')
    .select('user_id, correct_answers, total_time_ms, correct_streak')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)

  if (attError) return { rows: 0, error: attError.message }

  if (!rawAttempts || rawAttempts.length === 0) {
    // Ingen forsøk — marker som ferdig
    await supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: true })
      .eq('id', quizId)
    return { rows: 0, error: null }
  }

  // Beste forsøk per bruker
  const bestByUser = new Map<string, RawAttempt>()
  for (const a of rawAttempts as RawAttempt[]) {
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) : a)
  }

  const userIds = [...bestByUser.keys()]
  let totalRows = 0

  // ── Global scope ─────────────────────────────────────────────────────────────
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
  console.log(`[award-season-points]   global: ${globalRows.length} rader`)

  // ── League scope ─────────────────────────────────────────────────────────────
  const { data: leagueMemberships } = await supabaseAdmin
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

      const ranked = rankBestAttempts(leagueBest)
      const rows: ScoreRow[] = ranked.map(({ userId, rank }) => ({
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
    console.log(`[award-season-points]   league: ${byLeague.size} ligaer, scope-rader inkludert i total`)
  }

  // ── Organization scope ───────────────────────────────────────────────────────
  const { data: orgMemberships } = await supabaseAdmin
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

      const ranked = rankBestAttempts(orgBest)
      const rows: ScoreRow[] = ranked.map(({ userId, rank }) => ({
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
    console.log(`[award-season-points]   org: ${byOrg.size} organisasjoner, scope-rader inkludert i total`)
  }

  // Marker quizen som ferdig — settes ETTER alle inserts
  const { error: flagError } = await supabaseAdmin
    .from('quizzes')
    .update({ season_points_awarded: true })
    .eq('id', quizId)

  if (flagError) {
    console.error(`[award-season-points] Klarte ikke sette season_points_awarded på quiz ${quizId}:`, flagError.message)
  }

  return { rows: totalRows, error: null }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  // Finn ubehandlede quizer som har stengt
  const { data: quizzes, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .order('closes_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (quizError) {
    console.error('[award-season-points] Klarte ikke hente quizer:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 500 })
  }

  if (!quizzes || quizzes.length === 0) {
    return NextResponse.json({ processed: 0, totalRows: 0, quizzes: [] })
  }

  const results: Array<{ quizId: string; title: string; rows: number; error: string | null }> = []
  let totalRows = 0

  for (const quiz of quizzes as { id: string; title: string; closes_at: string }[]) {
    console.log(`[award-season-points] Behandler: "${quiz.title}" (${quiz.id})`)
    const { rows, error } = await processQuiz(quiz.id, quiz.closes_at)
    totalRows += rows
    results.push({ quizId: quiz.id, title: quiz.title, rows, error })
    if (error) {
      console.error(`[award-season-points] Feil på "${quiz.title}":`, error)
    } else {
      console.log(`[award-season-points] Ferdig: "${quiz.title}" — ${rows} rader totalt`)
    }
  }

  return NextResponse.json({ processed: results.length, totalRows, quizzes: results })
}
