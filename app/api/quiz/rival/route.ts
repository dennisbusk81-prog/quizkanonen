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
        .select('display_name, nickname')
        .eq('id', leaderUserId)
        .maybeSingle()
      leaderName = lp?.nickname?.trim() || lp?.display_name || 'Ukjent'
    }
  }

  return {
    top10MinCorrect,
    leaderName,
    leaderCorrect,
    totalPlayers: totalCount ?? 0,
  }
}

// Finn rival = personen nærmest OVER brukeren i quizens rangering (ikke toppen).
// - Har brukeren et fullført forsøk: personen rett over i rangeringen.
//   På 1. plass: personen rett under (eller ingen hvis alene).
// - Har ikke spilt ennå (vanlig under quiz): bruk median-plasseringen som
//   referanse og match mot personen rett over medianen — aldri toppen.
async function findRival(
  quizId: string,
  userId: string,
): Promise<{ user_id: string; correct_answers: number } | null> {
  const { data: attempts } = await supabaseAdmin
    .from('attempts')
    .select('user_id, correct_answers, total_time_ms')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)
    .not('submitted_at', 'is', null) // kun fullførte forsøk
    .gt('correct_answers', 0)        // ignorer 0-scorere
    .order('correct_answers', { ascending: false })
    .order('total_time_ms', { ascending: true })

  const ranked = attempts ?? []
  if (ranked.length === 0) return null

  // Behold beste forsøk per bruker (første forekomst = best, siden sortert)
  const seen = new Set<string>()
  const unique: { user_id: string; correct_answers: number }[] = []
  for (const a of ranked) {
    if (!a.user_id || seen.has(a.user_id)) continue
    seen.add(a.user_id)
    unique.push({ user_id: a.user_id, correct_answers: a.correct_answers ?? 0 })
  }
  if (unique.length === 0) return null

  const userIdx = unique.findIndex(a => a.user_id === userId)

  let rivalIdx: number
  if (userIdx === 0) {
    // Brukeren er på 1. plass — vis personen rett under (eller ingen)
    rivalIdx = unique.length > 1 ? 1 : -1
  } else if (userIdx > 0) {
    // Personen med nest høyeste score rett over brukeren
    rivalIdx = userIdx - 1
  } else {
    // Brukeren har ikke spilt ennå — median som referanse, personen rett over den
    const medianIdx = Math.floor(unique.length / 2)
    rivalIdx = Math.max(0, medianIdx - 1)
  }

  if (rivalIdx < 0 || rivalIdx >= unique.length) return null
  const rival = unique[rivalIdx]
  if (rival.user_id === userId) return null // sikkerhetsnett
  return rival
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

  // Rival = personen nærmest over brukeren i rangeringen (ikke toppen)
  const rivalRow = await findRival(quizId, userId)

  if (!rivalRow) {
    const rankingSnapshot = await buildRankingSnapshot(quizId)
    return NextResponse.json(
      { rival: null, rankingSnapshot },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )
  }

  const [profileResult, rankingSnapshot] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('display_name, nickname')
      .eq('id', rivalRow.user_id)
      .maybeSingle(),
    buildRankingSnapshot(quizId),
  ])

  // Kallenavn vises i stedet for ekte navn hvis satt (rival vises i løpende tekst)
  const rivalName = profileResult.data?.nickname?.trim()
    || profileResult.data?.display_name
    || 'Ukjent'

  return NextResponse.json(
    {
      rival: { name: rivalName, avatarColor: avatarColor(rivalRow.user_id), score: rivalRow.correct_answers },
      rankingSnapshot,
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
