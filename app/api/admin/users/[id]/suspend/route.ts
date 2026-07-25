import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const suspendedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  // .select('id') etter update: en .eq('id', id) som treffer 0 rader (utdatert
  // UI-cache, brukeren allerede slettet) er ikke en feil — error forblir null —
  // men skal ikke late som om noen ble suspendert.
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ suspended_until: suspendedUntil })
    .eq('id', id)
    .select('id')

  if (error) {
    console.error('[admin/users suspend] failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })
  }

  try {
    await supabaseAdmin.from('admin_actions').insert({
      action_type: 'suspend_user',
      scope_type: 'user',
      scope_id: id,
    })
  } catch { /* ikke kritisk */ }

  return NextResponse.json({ ok: true, suspended_until: suspendedUntil })
}
