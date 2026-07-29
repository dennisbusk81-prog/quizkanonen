import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUnlockedOrg, type OrgLockGuard } from '@/lib/org-lock-guard'

// Lås-avvisningen bæres ut som et eget felt i stedet for `null`, fordi `null`
// her betyr «ingen tilgang, svar tomt» — og en låst org skal få en tydelig 403
// med begrunnelse, ikke en tom liste som ser ut som «ingen har spilt ennå».
type SummaryResult =
  | { blocked: Extract<OrgLockGuard, { ok: false }> }
  | { blocked?: undefined; top3: unknown[]; userRank: unknown; orgName: string }

async function getSummary(token: string, slug: string): Promise<SummaryResult | null> {
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

  // Låst org: sjekkes ETTER medlemskapet, slik at en utenforstående ikke får
  // vite om en slug finnes eller hvilken tilstand den står i.
  const lock = await requireUnlockedOrg({ id: org.id })
  if (!lock.ok) return { blocked: lock }

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

  // PostgREST-embed for denne many-to-one-relasjonen (user_id er FK på
  // season_scores-siden) er ETT objekt, ikke et array — verifisert empirisk
  // mot prod 25. juli (samme bugklasse som my-orgs-regresjonen 24. juli).
  type Row = { user_id: string; points: number; profiles: { display_name: string | null } | null }
  const byUser = new Map<string, { displayName: string; totalPoints: number }>()
  for (const row of ((rows as unknown) as Row[] ?? [])) {
    const name = row.profiles?.display_name
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
  if (result?.blocked) {
    return NextResponse.json(result.blocked.body, { status: result.blocked.status })
  }
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
  if (result?.blocked) {
    return NextResponse.json(result.blocked.body, { status: result.blocked.status })
  }
  return NextResponse.json(result ?? { top3: [], userRank: null })
}
