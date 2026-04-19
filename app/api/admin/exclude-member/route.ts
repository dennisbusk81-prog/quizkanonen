import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/admin/exclude-member
// Body: { scope_type, scope_id, user_id, action: 'exclude'|'unexclude' }
// Auth: admin-passord, eller token med liga-eier / org-admin-rettigheter
export async function POST(request: NextRequest) {
  let body: { scope_type?: string; scope_id?: string; user_id?: string; action?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 }) }

  const { scope_type, scope_id, user_id, action } = body
  if (!scope_type || !scope_id || !user_id || !['exclude', 'unexclude'].includes(action ?? '')) {
    return NextResponse.json({ error: 'Mangler eller ugyldige felter' }, { status: 400 })
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const adminPw = request.headers.get('x-admin-password')
  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')

  let authed = false

  if (adminPw && adminPw === process.env.ADMIN_PASSWORD) {
    authed = true
  } else if (bearerToken) {
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
    if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

    if (scope_type === 'league') {
      const { data: league } = await supabaseAdmin
        .from('leagues')
        .select('owner_id')
        .eq('id', scope_id)
        .maybeSingle()
      authed = league?.owner_id === user.id
    } else if (scope_type === 'organization') {
      const { data: mem } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', scope_id)
        .eq('user_id', user.id)
        .maybeSingle()
      authed = mem?.role === 'admin'
    }
  }

  if (!authed) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  // ── Handling ──────────────────────────────────────────────────────────────────
  if (action === 'exclude') {
    const { error } = await supabaseAdmin
      .from('excluded_members')
      .upsert(
        { scope_type, scope_id, user_id, excluded_at: new Date().toISOString() },
        { onConflict: 'scope_type,scope_id,user_id', ignoreDuplicates: true }
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabaseAdmin
      .from('excluded_members')
      .delete()
      .eq('scope_type', scope_type)
      .eq('scope_id', scope_id)
      .eq('user_id', user_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
