import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type Params = { params: Promise<{ id: string }> }

function getPeriodStart(period: string): string {
  const now = new Date()
  if (period === 'month') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  }
  if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3)
    return new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)).toISOString()
  }
  // year
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
}

// GET /api/org/[id]/members-activity?period=month|quarter|year&format=csv
// Returnerer aktivitetsdata for alle org-medlemmer. Krever org-admin.
export async function GET(request: NextRequest, { params }: Params) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id: orgId } = await params
  const { searchParams } = new URL(request.url)
  const period = ['month', 'quarter', 'year'].includes(searchParams.get('period') ?? '')
    ? (searchParams.get('period') as 'month' | 'quarter' | 'year')
    : 'month'
  const format = searchParams.get('format')

  // Verifiser org-admin
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Kun admins kan se dette.' }, { status: 403 })
  }

  // Hent alle org-medlemmer
  const { data: orgMembers } = await supabaseAdmin
    .from('organization_members')
    .select('user_id, role, joined_at')
    .eq('organization_id', orgId)
    .order('joined_at', { ascending: true })

  if (!orgMembers || orgMembers.length === 0) {
    return format === 'csv'
      ? new NextResponse('Navn,Spilt denne perioden,Poeng,Antall quizer,Sist aktiv\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="aktivitet-${period}.csv"` },
        })
      : NextResponse.json({ members: [], period })
  }

  const memberIds = orgMembers.map(m => m.user_id)

  // Hent profiler
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, last_seen_at')
    .in('id', memberIds)

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  // Hent ekskluderte brukere
  const { data: excluded } = await supabaseAdmin
    .from('excluded_members')
    .select('user_id')
    .eq('scope_type', 'organization')
    .eq('scope_id', orgId)

  const excludedSet = new Set((excluded ?? []).map(e => e.user_id))

  // Hent season_scores for perioden
  const periodStart = getPeriodStart(period)
  const { data: scores } = await supabaseAdmin
    .from('season_scores')
    .select('user_id, points, quiz_id')
    .eq('scope_type', 'organization')
    .eq('scope_id', orgId)
    .gte('closes_at', periodStart)
    .in('user_id', memberIds)

  type UserStats = { points: number; quizCount: number; quizIds: Set<string> }
  const statsMap = new Map<string, UserStats>()
  for (const s of (scores ?? []) as { user_id: string; points: number; quiz_id: string }[]) {
    const existing = statsMap.get(s.user_id) ?? { points: 0, quizCount: 0, quizIds: new Set<string>() }
    if (!existing.quizIds.has(s.quiz_id)) {
      existing.points += s.points
      existing.quizCount += 1
      existing.quizIds.add(s.quiz_id)
    }
    statsMap.set(s.user_id, existing)
  }

  const members = orgMembers.map(m => {
    const profile = profileMap.get(m.user_id)
    const stats = statsMap.get(m.user_id)
    return {
      userId: m.user_id,
      displayName: profile?.display_name ?? m.user_id.slice(0, 8),
      role: m.role,
      joinedAt: m.joined_at,
      hasPlayed: !!stats,
      totalPoints: stats?.points ?? 0,
      quizCount: stats?.quizCount ?? 0,
      lastActiveAt: (profile as { last_seen_at?: string } | undefined)?.last_seen_at ?? null,
      isExcluded: excludedSet.has(m.user_id),
    }
  })

  // Sorter: spilt (poeng DESC) → ikke spilt (alfabetisk)
  members.sort((a, b) => {
    if (a.hasPlayed !== b.hasPlayed) return a.hasPlayed ? -1 : 1
    if (a.hasPlayed && b.hasPlayed) return b.totalPoints - a.totalPoints
    return a.displayName.localeCompare(b.displayName, 'nb')
  })

  if (format === 'csv') {
    const periodLabel = period === 'month' ? 'Måned' : period === 'quarter' ? 'Kvartal' : 'År'
    const header = `Navn,Rolle,Spilt (${periodLabel}),Poeng,Antall quizer,Sist aktiv`
    const rows = members.map(m => [
      `"${m.displayName.replace(/"/g, '""')}"`,
      m.role === 'admin' ? 'Admin' : 'Medlem',
      m.hasPlayed ? 'Ja' : 'Nei',
      m.totalPoints,
      m.quizCount,
      m.lastActiveAt ? new Date(m.lastActiveAt).toLocaleDateString('nb-NO') : '—',
    ].join(','))
    const csv = [header, ...rows].join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="aktivitet-${period}.csv"`,
      },
    })
  }

  return NextResponse.json({ members, period })
}
