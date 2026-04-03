import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAttemptDetail } from '@/lib/history'
import type { AttemptDetail } from '@/lib/history'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
): Promise<NextResponse<AttemptDetail | { error: string }>> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status')
    .eq('id', user.id)
    .single()

  if (!profile?.premium_status) {
    return NextResponse.json({ error: 'Krever premium' }, { status: 403 })
  }

  const { attemptId } = await params
  const detail = await getAttemptDetail(attemptId, user.id)

  if (!detail) {
    // Either not found or belongs to another user — same 404 response for security
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  }

  return NextResponse.json(detail)
}
