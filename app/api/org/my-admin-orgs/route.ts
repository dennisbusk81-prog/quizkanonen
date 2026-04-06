import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ orgs: [] })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ orgs: [] })

  const { data: memberships, error } = await supabaseAdmin
    .from('organization_members')
    .select('organizations(name, slug)')
    .eq('user_id', user.id)
    .eq('role', 'admin')

  if (error) {
    console.error('[my-admin-orgs] query error:', error)
    return NextResponse.json({ orgs: [] })
  }

  const orgs = (memberships ?? [])
    .map(m => {
      const raw = (m as unknown as { organizations: { name: string; slug: string } | { name: string; slug: string }[] | null }).organizations
      const org = Array.isArray(raw) ? raw[0] ?? null : raw
      return org ? { orgName: org.name, orgSlug: org.slug } : null
    })
    .filter((x): x is { orgName: string; orgSlug: string } => x !== null)

  return NextResponse.json({ orgs })
}
