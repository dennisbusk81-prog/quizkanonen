import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/org/my-orgs
// Returnerer alle organisasjoner brukeren er medlem av (uavhengig av rolle).
export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    console.log('[my-orgs] no token')
    return NextResponse.json({ orgs: [] })
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) {
    console.error('[my-orgs] getUser failed:', authErr?.message, 'token prefix:', token.slice(0, 20))
    return NextResponse.json({ orgs: [] })
  }

  console.log('[my-orgs] user id:', user.id)

  const { data: memberships, error: memErr } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)

  if (memErr) {
    console.error('[my-orgs] memberships query error:', memErr)
    return NextResponse.json({ orgs: [] })
  }

  console.log('[my-orgs] memberships:', memberships)

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ orgs: [] })
  }

  const orgIds = memberships.map(m => m.organization_id).filter(Boolean)

  const { data: orgs, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .in('id', orgIds)

  if (orgErr) {
    console.error('[my-orgs] orgs query error:', orgErr)
    return NextResponse.json({ orgs: [] })
  }

  console.log('[my-orgs] orgs found:', orgs)

  const roleByOrg = new Map(memberships.map(m => [m.organization_id, m.role]))

  const result = (orgs ?? []).map(o => ({
    orgId:   o.id,
    orgName: o.name,
    orgSlug: o.slug,
    isAdmin: roleByOrg.get(o.id) === 'admin',
  }))

  console.log('[my-orgs] returning:', result)
  return NextResponse.json({ orgs: result })
}
