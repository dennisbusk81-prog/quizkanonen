import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Server-side rangering for ukens quiz-leaderboard ─────────────────────────
// Mønster: speiler /api/toppliste. Rangerer RÅ attempt-rader (ingen dedup per
// bruker), separate rom via is_team. RPC (quiz_leaderboard_*) med automatisk
// JS-fallback hvis migrasjon 20260614000015 ikke er kjørt enda.

type LbEntry = {
  rank: number
  id: string
  userId: string | null
  playerName: string
  correctAnswers: number
  totalQuestions: number
  totalTimeMs: number
  correctStreak: number | null
  isTeam: boolean
  teamSize: number
  leaderDisplayName: string | null
}

type RawRow = {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  is_team: boolean
  team_size: number
  leader_display_name: string | null
}

const SELECT_COLS =
  'id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, team_size, leader_display_name'

// Samme tiebreak som lib/ranking.ts: correct DESC, tid ASC, streak DESC, id ASC.
function rankRows(rows: RawRow[]): Array<RawRow & { rank: number }> {
  const sorted = [...rows].sort((a, b) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
    const sd = (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
    if (sd !== 0) return sd
    return a.id.localeCompare(b.id)
  })
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }))
}

function toEntry(r: RawRow & { rank: number }): LbEntry {
  return {
    rank: r.rank,
    id: r.id,
    userId: r.user_id,
    playerName: r.player_name,
    correctAnswers: r.correct_answers,
    totalQuestions: r.total_questions,
    totalTimeMs: r.total_time_ms,
    correctStreak: r.correct_streak,
    isTeam: r.is_team,
    teamSize: r.team_size,
    leaderDisplayName: r.leader_display_name,
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await context.params
  if (!quizId) return NextResponse.json({ error: 'Mangler quiz-id' }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const isTeam = searchParams.get('is_team') === 'true'

  const pageParamRaw = searchParams.get('page')
  const searchRaw = (searchParams.get('search') ?? '').trim()
  const isBrowse = pageParamRaw !== null || searchRaw !== ''
  const search = searchRaw === '' ? null : searchRaw
  const page = Math.max(1, parseInt(pageParamRaw ?? '1', 10) || 1)

  // Klassisk visning: topp `limit` (default 50, maks 200). Browse: 20/side.
  const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10)
  const classicLimit = Math.min(200, Math.max(1, Number.isNaN(limitRaw) ? 50 : limitRaw))
  const pageSize = isBrowse ? 20 : classicLimit

  // Identifiser bruker + premium-status
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  let userId: string | null = null
  let userIsPremium = false
  if (token) {
    const { data: authData } = await supabaseAdmin.auth.getUser(token)
    userId = authData.user?.id ?? null
  }

  // Gjest-estimat ("et sted mellom X og Y") — kun for uinnloggede med lagret score
  const myCorrectRaw = searchParams.get('my_correct')
  const myTimeRaw = searchParams.get('my_time')
  const guestScore =
    !userId && myCorrectRaw !== null && myTimeRaw !== null
      ? { correct: parseInt(myCorrectRaw, 10), timeMs: parseInt(myTimeRaw, 10) }
      : null

  // ── Forsøk RPC-sti ──────────────────────────────────────────────────────────
  type RankedRow = RawRow & { rank: number; total_count: number }
  const { data: rankedData, error: rankedError } = await supabaseAdmin.rpc('quiz_leaderboard_ranked', {
    p_quiz_id: quizId,
    p_is_team: isTeam,
    p_page: isBrowse ? page : 1,
    p_page_size: pageSize,
    p_search: isBrowse ? search : null,
  })

  if (!rankedError) {
    // ── RPC-STI ────────────────────────────────────────────────────────────────
    const rows = (rankedData ?? []) as RankedRow[]
    const totalCount = Number(rows[0]?.total_count ?? 0)
    const entries: LbEntry[] = rows.map(r => toEntry({ ...r, rank: Number(r.rank) }))

    let userEntry: LbEntry | null = null
    let userRank: number | null = null
    if (userId) {
      const [{ data: us }, { data: prof }] = await Promise.all([
        supabaseAdmin.rpc('quiz_leaderboard_user_stats', { p_quiz_id: quizId, p_is_team: isTeam, p_user_id: userId }),
        supabaseAdmin.from('profiles').select('display_name, premium_status').eq('id', userId).maybeSingle(),
      ])
      userIsPremium = prof?.premium_status === true
      const row = (us ?? [])[0] as (RawRow & { rank: number }) | undefined
      if (row) {
        userRank = Number(row.rank)
        userEntry = toEntry({ ...row, rank: Number(row.rank), user_id: userId, is_team: isTeam })
      }
    }

    let guestRank: number | null = null
    if (guestScore && !Number.isNaN(guestScore.correct) && !Number.isNaN(guestScore.timeMs)) {
      const { data: bc } = await supabaseAdmin.rpc('quiz_leaderboard_better_count', {
        p_quiz_id: quizId, p_is_team: isTeam, p_correct: guestScore.correct, p_time_ms: guestScore.timeMs,
      })
      guestRank = Number(bc ?? 0) + 1
    }

    return NextResponse.json({
      entries, totalCount, userEntry, userRank, guestRank,
      userIsPremium, page, pageSize, isTeam,
    })
  }

  // ── JS-FALLBACK (pre-migrasjon) ──────────────────────────────────────────────
  console.warn('[leaderboard] RPC quiz_leaderboard_ranked utilgjengelig, bruker JS-fallback:', rankedError?.message)

  const { data: allRowsRaw } = await supabaseAdmin
    .from('attempts')
    .select(SELECT_COLS)
    .eq('quiz_id', quizId)
    .eq('is_team', isTeam)
    .limit(5000)

  const ranked = rankRows((allRowsRaw ?? []) as RawRow[])
  const totalAll = ranked.length

  // Premium-status (fallback)
  if (userId) {
    const { data: prof } = await supabaseAdmin.from('profiles').select('premium_status').eq('id', userId).maybeSingle()
    userIsPremium = prof?.premium_status === true
  }

  // Brukerens beste plassering
  let userEntry: LbEntry | null = null
  let userRank: number | null = null
  if (userId) {
    const mine = ranked.find(r => r.user_id === userId)
    if (mine) { userRank = mine.rank; userEntry = toEntry(mine) }
  }

  // Gjest-estimat
  let guestRank: number | null = null
  if (guestScore && !Number.isNaN(guestScore.correct) && !Number.isNaN(guestScore.timeMs)) {
    const better = ranked.filter(r =>
      r.correct_answers > guestScore.correct ||
      (r.correct_answers === guestScore.correct && r.total_time_ms < guestScore.timeMs)
    ).length
    guestRank = better + 1
  }

  // Søk + paginering i JS
  const filtered = search
    ? ranked.filter(r => r.player_name.toLowerCase().includes(search.toLowerCase()))
    : ranked
  const totalCount = search ? filtered.length : totalAll
  const start = isBrowse ? (page - 1) * pageSize : 0
  const slice = filtered.slice(start, start + pageSize)
  const entries: LbEntry[] = slice.map(toEntry)

  return NextResponse.json({
    entries, totalCount, userEntry, userRank, guestRank,
    userIsPremium, page, pageSize, isTeam,
  })
}
