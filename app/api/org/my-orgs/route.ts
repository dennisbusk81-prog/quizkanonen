import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/org/my-orgs
// Body: { access_token: string }
// Returnerer alle organisasjoner brukeren er medlem av (uavhengig av rolle).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access_token: string | undefined = body?.access_token

  if (!access_token) {
    return NextResponse.json({ orgs: [] })
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(access_token)

  if (authErr || !user) {
    console.error('[my-orgs] getUser feil:', authErr?.message)
    return NextResponse.json({ orgs: [] })
  }

  const { data: memberships, error: memErr } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)

  if (memErr || !memberships || memberships.length === 0) {
    return NextResponse.json({ orgs: [] })
  }

  const orgIds = memberships.map(m => m.organization_id).filter(Boolean)

  const { data: orgs, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, allow_global_league')
    .in('id', orgIds)

  if (orgErr) {
    return NextResponse.json({ orgs: [] })
  }

  const roleByOrg = new Map(memberships.map(m => [m.organization_id, m.role]))

  const result = (orgs ?? []).map(o => ({
    orgId:             o.id,
    orgName:           o.name,
    orgSlug:           o.slug,
    isAdmin:           roleByOrg.get(o.id) === 'admin',
    allowGlobalLeague: o.allow_global_league !== false,
  }))

  return NextResponse.json({ orgs: result })
}
