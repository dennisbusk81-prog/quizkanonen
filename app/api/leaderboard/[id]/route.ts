import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankQuizAttempts } from '@/lib/ranking'

// ── Server-side rangering for ukens quiz-leaderboard ─────────────────────────
// Bruker den delte rangerings-helperen (lib/ranking): submitted-filter, dedup
// per spiller (user_id, ellers player_name for gjester), 4-nøkkels tiebreak.
// Gjester inkluderes. Identisk #1 som Topp 3 og toppliste. Separate rom via
// is_team. RPC-stien er fjernet bevisst — den dedup'et ikke og ga duplikate
// rader + ulik vinner.

type LbEntry = {
  rank: number
  id: string
  userId: string | null
  playerName: string
  nickname: string | null
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
  submitted_at: string | null
}

const SELECT_COLS =
  'id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, team_size, leader_display_name, submitted_at'

function toEntry(r: RawRow & { rank: number }, nickname: string | null = null): LbEntry {
  return {
    rank: r.rank,
    id: r.id,
    userId: r.user_id,
    playerName: r.player_name,
    nickname,
    correctAnswers: r.correct_answers,
    totalQuestions: r.total_questions,
    totalTimeMs: r.total_time_ms,
    correctStreak: r.correct_streak,
    isTeam: r.is_team,
    teamSize: r.team_size,
    leaderDisplayName: r.leader_display_name,
  }
}

// Henter kallenavn (nickname) for et sett user_id-er via service role (omgår
// kolonne-grants på profiles som ellers kan blokkere anon-lesing av nickname).
async function fetchNicknames(entries: LbEntry[]): Promise<void> {
  const ids = [...new Set(entries.map(e => e.userId).filter((id): id is string => !!id))]
  if (ids.length === 0) return
  const { data } = await supabaseAdmin.from('profiles').select('id, nickname').in('id', ids)
  const map = new Map<string, string | null>()
  for (const p of (data ?? []) as { id: string; nickname: string | null }[]) {
    map.set(p.id, p.nickname ?? null)
  }
  for (const e of entries) {
    if (e.userId) e.nickname = map.get(e.userId) ?? null
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

  // ── Delt rangerings-helper (service role) ────────────────────────────────────
  // Henter alle rader for rommet (solo/lag), filtrerer på submitted, dedup'er per
  // spiller og rangerer med 4-nøkkels tiebreak. Søk/paginering skjer i JS etterpå.
  const { data: allRowsRaw } = await supabaseAdmin
    .from('attempts')
    .select(SELECT_COLS)
    .eq('quiz_id', quizId)
    .eq('is_team', isTeam)
    .limit(5000)

  const ranked = rankQuizAttempts((allRowsRaw ?? []) as RawRow[], {
    includeGuests: true,
    requireSubmitted: true,
  })
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
  const entries: LbEntry[] = slice.map(r => toEntry(r))

  await fetchNicknames(userEntry ? [...entries, userEntry] : entries)

  return NextResponse.json({
    entries, totalCount, userEntry, userRank, guestRank,
    userIsPremium, page, pageSize, isTeam,
  })
}
