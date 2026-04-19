import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/org/my-orgs
// Returnerer alle organisasjoner brukeren er medlem av (uavhengig av rolle).
export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ orgs: [] })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ orgs: [] })

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
    .select('id, name, slug')
    .in('id', orgIds)

  if (orgErr) return NextResponse.json({ orgs: [] })

  const roleByOrg = new Map(memberships.map(m => [m.organization_id, m.role]))

  const result = (orgs ?? []).map(o => ({
    orgId:   o.id,
    orgName: o.name,
    orgSlug: o.slug,
    isAdmin: roleByOrg.get(o.id) === 'admin',
  }))

  return NextResponse.json({ orgs: result })
}
