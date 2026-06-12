import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

function avatarColor(seed: string): string {
  const palette = ['#c9a84c', '#4ade80', '#4c94c9', '#c9a84c', '#4ade80']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

async function buildRankingSnapshot(quizId: string) {
  const [{ data: top11 }, { count: totalCount }] = await Promise.all([
    supabaseAdmin
      .from('attempts')
      .select('user_id, correct_answers, total_time_ms')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .order('correct_answers', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .limit(11),
    supabaseAdmin
      .from('attempts')
      .select('*', { count: 'exact', head: true })
      .eq('quiz_id', quizId)
      .eq('is_team', false),
  ])

  const top11List = top11 ?? []
  const top10MinCorrect = top11List.length >= 10 ? (top11List[9]?.correct_answers ?? 0) : 0
  let leaderName = 'Ukjent'
  let leaderCorrect = 0

  if (top11List.length > 0) {
    leaderCorrect = top11List[0].correct_answers ?? 0
    const leaderUserId = top11List[0].user_id
    if (leaderUserId) {
      const { data: lp } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', leaderUserId)
        .maybeSingle()
      leaderName = lp?.display_name ?? 'Ukjent'
    }
  }

  return {
    top10MinCorrect,
    leaderName,
    leaderCorrect,
    totalPlayers: totalCount ?? 0,
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const quizId = searchParams.get('quizId')

  if (!quizId) {
    return NextResponse.json({ rival: null, rankingSnapshot: null }, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  }

  // FIX 5 — require auth; use user.id from token instead of query param.
  // If no token (guest user), return ranking snapshot only — rival requires a user identity.
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    const rankingSnapshot = await buildRankingSnapshot(quizId)
    return NextResponse.json(
      { rival: null, rankingSnapshot },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    )
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    const rankingSnapshot = await buildRankingSnapshot(quizId)
    return NextResponse.json(
      { rival: null, rankingSnapshot },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    )
  }

  // FIX 5 — userId comes from the verified token, not from query params
  const userId = user.id

  // Find user's leagues
  const { data: memberships } = await supabaseAdmin
    .from('league_members')
    .select('league_id')
    .eq('user_id', userId)

  const leagueIds = (memberships ?? []).map(m => m.league_id).filter(Boolean)

  let rivalUserId: string | null = null
  let rivalScore: number | null = null

  if (leagueIds.length > 0) {
    // Get other members of user's leagues
    const { data: leagueMembers } = await supabaseAdmin
      .from('league_members')
      .select('user_id')
      .in('league_id', leagueIds)
      .neq('user_id', userId)

    const peerIds = [...new Set((leagueMembers ?? []).map(m => m.user_id).filter(Boolean))]

    if (peerIds.length > 0) {
      // Find the peer with best attempt on this quiz
      const { data: peerAttempts } = await supabaseAdmin
        .from('attempts')
        .select('user_id, correct_answers')
        .eq('quiz_id', quizId)
        .eq('is_team', false)
        .in('user_id', peerIds)
        .order('correct_answers', { ascending: false })
        .limit(1)

      if (peerAttempts && peerAttempts.length > 0) {
        rivalUserId = peerAttempts[0].user_id
        rivalScore = peerAttempts[0].correct_answers
      }
    }
  }

  // Fallback: global top player (not the user)
  if (!rivalUserId) {
    const { data: topAttempts } = await supabaseAdmin
      .from('attempts')
      .select('user_id, correct_answers')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .neq('user_id', userId)
      .not('user_id', 'is', null)
      .order('correct_answers', { ascending: false })
      .limit(1)

    if (topAttempts && topAttempts.length > 0) {
      rivalUserId = topAttempts[0].user_id
      rivalScore = topAttempts[0].correct_answers
    }
  }

  // Build ranking snapshot in parallel with rival profile lookup
  if (!rivalUserId || rivalScore === null) {
    const rankingSnapshot = await buildRankingSnapshot(quizId)
    return NextResponse.json(
      { rival: null, rankingSnapshot },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )
  }

  const [profileResult, rankingSnapshot] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', rivalUserId)
      .maybeSingle(),
    buildRankingSnapshot(quizId),
  ])

  const rivalName = profileResult.data?.display_name ?? 'Ukjent'

  return NextResponse.json(
    {
      rival: { name: rivalName, avatarColor: avatarColor(rivalUserId), score: rivalScore },
      rankingSnapshot,
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
