import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/rivalries/my — returns my active + pending rivalries with opponent info + season scores
export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // Fetch all active/pending rivalries where user is challenger or rival
  const { data: rivalries, error } = await supabaseAdmin
    .from('rivalries')
    .select('id, challenger_id, rival_id, status, created_at')
    .or(`challenger_id.eq.${user.id},rival_id.eq.${user.id}`)
    .in('status', ['active', 'pending'])
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[rivalries/my GET] error:', error.message)
    return NextResponse.json({ error: 'Noe gikk galt.' }, { status: 500 })
  }

  const rows = rivalries ?? []

  if (rows.length === 0) {
    return NextResponse.json({ rivalries: [] })
  }

  // Fix 3 — detect expired duels: any rivalry created before the start of this calendar month
  const now = new Date()
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthStart = thisMonthStart.toISOString()
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

  // Collect all opponent IDs
  const opponentIds = rows.map(r => r.challenger_id === user.id ? r.rival_id : r.challenger_id)
  const uniqueOpponentIds = [...new Set(opponentIds)]

  // Fetch opponent profiles
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', uniqueOpponentIds)

  const profileMap = new Map(
    (profiles ?? []).map((p: { id: string; display_name: string | null; avatar_url: string | null }) => [p.id, p])
  )

  // Fetch season scores for current month (global scope) for all involved user IDs
  const allUserIds = [user.id, ...uniqueOpponentIds]

  const { data: seasonScores } = await supabaseAdmin
    .from('season_scores')
    .select('user_id, points')
    .eq('scope_type', 'global')
    .is('scope_id', null)
    .gte('closes_at', monthStart)
    .lt('closes_at', monthEnd)
    .in('user_id', allUserIds)

  // Sum points per user
  const pointsMap = new Map<string, number>()
  for (const row of (seasonScores ?? []) as { user_id: string; points: number }[]) {
    pointsMap.set(row.user_id, (pointsMap.get(row.user_id) ?? 0) + row.points)
  }

  const result = rows.map(r => {
    const opponentId = r.challenger_id === user.id ? r.rival_id : r.challenger_id
    const opponentProfile = profileMap.get(opponentId)
    // Fix 3: mark as expired if the duel was created in a previous calendar month
    const isExpired = new Date(r.created_at) < thisMonthStart
    return {
      id:             r.id,
      status:         r.status,
      isChallenger:   r.challenger_id === user.id,
      isExpired,
      opponentId,
      opponentName:   opponentProfile?.display_name ?? null,
      opponentAvatar: opponentProfile?.avatar_url ?? null,
      myPoints:       pointsMap.get(user.id) ?? 0,
      opponentPoints: pointsMap.get(opponentId) ?? 0,
    }
  })

  return NextResponse.json({ rivalries: result })
}
