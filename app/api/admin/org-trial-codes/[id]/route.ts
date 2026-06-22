import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/admin/org-trial-codes/[id] — slett en ubrukt engangskode.
// Avviser sletting hvis koden allerede er innløst (used_at IS NOT NULL).
export async function DELETE(request: NextRequest, { params }: Params) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: row } = await supabaseAdmin
    .from('org_trial_codes')
    .select('used_at')
    .eq('id', id)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Koden finnes ikke' }, { status: 404 })
  if (row.used_at) return NextResponse.json({ error: 'Kan ikke slette en allerede brukt kode' }, { status: 409 })

  const { error } = await supabaseAdmin.from('org_trial_codes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
