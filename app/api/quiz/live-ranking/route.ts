import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// FIX 12 — removed `export const revalidate = 30`; caching is set via response headers instead

type AttemptRow = {
  user_id: string
  player_name: string
  correct_answers: number
  total_time_ms: number
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const quizId         = searchParams.get('quiz_id')
  const currentCorrect = parseInt(searchParams.get('current_correct') ?? '0', 10)
  const currentTime    = parseInt(searchParams.get('current_time_ms') ?? '0', 10)

  if (!quizId) {
    return NextResponse.json({ error: 'quiz_id required' }, { status: 400 })
  }

  // FIX 12 — max-age=0 so browsers revalidate every time; s-maxage=30 lets CDN/edge cache for 30s
  const HEADERS = { 'Cache-Control': 'public, s-maxage=30, max-age=0' }

  // FIX 6 — add ORDER BY and increase limit to 500
  const { data: rawAttempts } = await supabaseAdmin
    .from('attempts')
    .select('user_id, player_name, correct_answers, total_time_ms')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)
    .order('correct_answers', { ascending: false })
    .order('total_time_ms', { ascending: true })
    .limit(500)

  if (!rawAttempts || rawAttempts.length === 0) {
    return NextResponse.json(
      { totalPlayers: 0, userRank: 1, above: null, below: null },
      { headers: HEADERS }
    )
  }

  // Beste attempt per bruker
  const bestByUser = new Map<string, AttemptRow>()
  for (const a of rawAttempts as AttemptRow[]) {
    const existing = bestByUser.get(a.user_id)
    if (
      !existing ||
      a.correct_answers > existing.correct_answers ||
      (a.correct_answers === existing.correct_answers && a.total_time_ms < existing.total_time_ms)
    ) {
      bestByUser.set(a.user_id, a)
    }
  }

  // Sorter fallende på correct_answers, stigende på tid
  const sorted = [...bestByUser.values()].sort((a, b) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    return a.total_time_ms - b.total_time_ms
  })

  const totalPlayers = sorted.length

  // Spillere strengt over/under brukerens current_correct, med tidsbreaker
  const strictlyAbove = sorted.filter(p =>
    p.correct_answers > currentCorrect ||
    (p.correct_answers === currentCorrect && currentTime > 0 && p.total_time_ms < currentTime)
  )
  const strictlyBelow = sorted.filter(p =>
    p.correct_answers < currentCorrect ||
    (p.correct_answers === currentCorrect && currentTime > 0 && p.total_time_ms > currentTime)
  )

  // "Above" = siste (nærmeste) i rekken av spillere med flere riktige
  const aboveEntry = strictlyAbove.length > 0 ? strictlyAbove[strictlyAbove.length - 1] : null
  // "Below" = første (nærmeste) i rekken av spillere med færre riktige
  const belowEntry = strictlyBelow.length > 0 ? strictlyBelow[0] : null
  // Brukerens rang = antall spillere med strengt flere riktige + 1
  const userRank = strictlyAbove.length + 1

  // Slå opp display_name for spillere vi trenger å vise
  const idsToLookup = [aboveEntry?.user_id, belowEntry?.user_id].filter((id): id is string => !!id)
  const nameMap = new Map<string, string>()

  if (idsToLookup.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .in('id', idsToLookup)
    for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
      if (p.display_name) nameMap.set(p.id, p.display_name)
    }
  }

  const resolveName = (entry: AttemptRow): string =>
    nameMap.get(entry.user_id) ?? entry.player_name

  return NextResponse.json(
    {
      totalPlayers,
      userRank,
      above: aboveEntry ? { name: resolveName(aboveEntry), correct: aboveEntry.correct_answers } : null,
      below: belowEntry ? { name: resolveName(belowEntry), correct: belowEntry.correct_answers } : null,
    },
    { headers: HEADERS }
  )
}
