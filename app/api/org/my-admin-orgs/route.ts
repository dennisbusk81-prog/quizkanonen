import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ orgs: [] })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) {
    console.error('[my-admin-orgs] getUser failed for token', token?.slice(0, 20))
    return NextResponse.json({ orgs: [] })
  }

  // Two flat queries — avoids dependency on FK constraint for nested select
  const { data: memberships, error: memErr } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('role', 'admin')

  if (memErr) {
    console.error('[my-admin-orgs] memberships query error:', memErr)
    return NextResponse.json({ orgs: [] })
  }

  const orgIds = (memberships ?? []).map(m => m.organization_id).filter(Boolean)
  console.log('[my-admin-orgs] user', user.id, '→ admin org ids:', orgIds)

  if (orgIds.length === 0) return NextResponse.json({ orgs: [] })

  const { data: orgs, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('name, slug')
    .in('id', orgIds)

  if (orgErr) {
    console.error('[my-admin-orgs] orgs query error:', orgErr)
    return NextResponse.json({ orgs: [] })
  }

  const result = (orgs ?? []).map(o => ({ orgName: o.name, orgSlug: o.slug }))
  console.log('[my-admin-orgs] returning:', result)
  return NextResponse.json({ orgs: result })
}
