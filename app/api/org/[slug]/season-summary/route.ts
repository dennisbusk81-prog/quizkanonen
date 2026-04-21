import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

async function getSummary(token: string, slug: string) {
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return null

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle()
  if (!org) return null

  const { data: mem } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!mem) return null

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

  const { data: rows } = await supabaseAdmin
    .from('season_scores')
    .select('user_id, points, profiles(display_name)')
    .eq('scope_type', 'organization')
    .eq('scope_id', org.id)
    .gte('closes_at', monthStart)
    .lt('closes_at', monthEnd)

  type Row = { user_id: string; points: number; profiles: { display_name: string | null }[] | null }
  const byUser = new Map<string, { displayName: string; totalPoints: number }>()
  for (const row of ((rows as unknown) as Row[] ?? [])) {
    const name = row.profiles?.[0]?.display_name
    if (!name) continue
    const ex = byUser.get(row.user_id)
    if (ex) ex.totalPoints += row.points
    else byUser.set(row.user_id, { displayName: name, totalPoints: row.points })
  }

  const sorted = Array.from(byUser.entries()).sort((a, b) => b[1].totalPoints - a[1].totalPoints)
  const top3 = sorted.slice(0, 3).map(([, v]) => v)
  const userIdx = sorted.findIndex(([uid]) => uid === user.id)

  return {
    top3,
    userRank: userIdx >= 0 ? userIdx + 1 : null,
    orgName: org.name,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ top3: [], userRank: null })
  const { slug } = await params
  const result = await getSummary(token, slug)
  return NextResponse.json(result ?? { top3: [], userRank: null })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const body = await request.json().catch(() => ({}))
  const token: string | undefined = body?.access_token
  if (!token) return NextResponse.json({ top3: [], userRank: null })
  const { slug } = await params
  const result = await getSummary(token, slug)
  return NextResponse.json(result ?? { top3: [], userRank: null })
}
