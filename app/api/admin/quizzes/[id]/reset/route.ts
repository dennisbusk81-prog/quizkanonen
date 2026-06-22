import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { data: attempts } = await supabaseAdmin.from('attempts').select('id').eq('quiz_id', id)
  if (attempts && attempts.length > 0) {
    const ids = attempts.map((a: { id: string }) => a.id)
    await supabaseAdmin.from('attempt_answers').delete().in('attempt_id', ids)
    await supabaseAdmin.from('attempts').delete().eq('quiz_id', id)
  }
  await supabaseAdmin.from('played_log').delete().eq('quiz_id', id)
  return NextResponse.json({ ok: true })
}
