import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

// Samme vakt som søsterruten [id]/route.ts: rå sti-id skal ikke nå Postgres.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Ugyldig bruker-id' }, { status: 400 })

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
