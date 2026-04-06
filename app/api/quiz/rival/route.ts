import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

function avatarColor(seed: string): string {
  const palette = ['#c9a84c', '#4caf7d', '#4c94c9', '#af4cc9', '#c94c7d']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const quizId = searchParams.get('quizId')
  const userId = searchParams.get('userId')

  if (!quizId || !userId) {
    return NextResponse.json({ rival: null }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    })
  }

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
      .neq('user_id', userId)
      .not('user_id', 'is', null)
      .order('correct_answers', { ascending: false })
      .limit(1)

    if (topAttempts && topAttempts.length > 0) {
      rivalUserId = topAttempts[0].user_id
      rivalScore = topAttempts[0].correct_answers
    }
  }

  if (!rivalUserId || rivalScore === null) {
    return NextResponse.json({ rival: null }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('display_name')
    .eq('id', rivalUserId)
    .maybeSingle()

  const rivalName = profile?.display_name ?? 'Ukjent'

  return NextResponse.json(
    { rival: { name: rivalName, avatarColor: avatarColor(rivalUserId), score: rivalScore } },
    { headers: { 'Cache-Control': 'public, max-age=60' } }
  )
}
