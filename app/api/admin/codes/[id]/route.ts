import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json()
  // .select('id') etter update: en .eq('id', id) som treffer 0 rader er ikke en
  // feil — error forblir null — men skal ikke late som om koden ble lagret.
  const { data, error } = await supabaseAdmin.from('access_codes').update(body).eq('id', id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'Kode ikke funnet' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
