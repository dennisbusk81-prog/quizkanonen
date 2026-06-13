import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const suspendedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ suspended_until: suspendedUntil })
    .eq('id', id)

  if (error) {
    console.error('[admin/users suspend] failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, suspended_until: suspendedUntil })
}
