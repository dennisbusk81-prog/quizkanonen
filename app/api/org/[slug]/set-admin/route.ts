import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user: requester }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !requester) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  const body = await request.json().catch(() => ({}))
  const email: string | undefined = body?.email?.trim().toLowerCase()
  const userId: string | undefined = body?.userId
  const action: 'add' | 'remove' | undefined = body?.action

  if ((!email && !userId) || !action || !['add', 'remove'].includes(action)) {
    return NextResponse.json({ error: 'Mangler email/userId eller action' }, { status: 400 })
  }

  // Get org
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (!org) return NextResponse.json({ error: 'Org ikke funnet' }, { status: 404 })

  // Verify requester is admin
  const { data: requesterMembership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', requester.id)
    .maybeSingle()
  if (requesterMembership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })
  }

  // Find target user — by userId directly (remove) or by email (add)
  let targetUserId: string
  if (userId) {
    targetUserId = userId
  } else {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const found = users.find(u => u.email?.toLowerCase() === email)
    if (!found) {
      return NextResponse.json({ error: 'Finner ingen bruker med den e-postadressen' }, { status: 404 })
    }
    targetUserId = found.id
  }

  // Prevent self-demotion
  if (action === 'remove' && targetUserId === requester.id) {
    return NextResponse.json({ error: 'Du kan ikke fjerne admin-rollen fra deg selv' }, { status: 400 })
  }

  // Verify target is a member of this org
  const { data: targetMembership } = await supabaseAdmin
    .from('organization_members')
    .select('id, role')
    .eq('organization_id', org.id)
    .eq('user_id', targetUserId)
    .maybeSingle()
  if (!targetMembership) {
    return NextResponse.json({ error: 'Brukeren er ikke medlem av denne organisasjonen' }, { status: 404 })
  }

  const newRole = action === 'add' ? 'admin' : 'member'
  const { error: updateErr } = await supabaseAdmin
    .from('organization_members')
    .update({ role: newRole })
    .eq('id', targetMembership.id)

  if (updateErr) {
    return NextResponse.json({ error: 'Kunne ikke oppdatere rolle' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
