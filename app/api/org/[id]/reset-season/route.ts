import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

// POST /api/org/[id]/reset-season — slett season_scores for denne organisasjonen (krever org-admin)
export async function POST(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-season-reset:${ip}`, 5, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id: orgId } = await params

  // Verifiser at brukeren er org-admin
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Kun admins kan nullstille sesong-data.' }, { status: 403 })
  }

  // Slett season_scores for denne organisasjonen
  const { error: delErr } = await supabaseAdmin
    .from('season_scores')
    .delete()
    .eq('scope_type', 'organization')
    .eq('scope_id', orgId)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // Logg handlingen
  try {
    await supabaseAdmin.from('admin_actions').insert({
      user_id: user.id, action_type: 'season_reset_all', scope_type: 'organization', scope_id: orgId,
    })
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true })
}
