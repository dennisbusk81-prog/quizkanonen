import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getPlayerHistory, getPlayerStats } from '@/lib/history'
import type { PlayerHistoryResult } from '@/lib/history'

export async function GET(request: NextRequest): Promise<NextResponse<PlayerHistoryResult | { error: string }>> {
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

  const [history, stats] = await Promise.all([
    getPlayerHistory(user.id),
    getPlayerStats(user.id),
  ])

  return NextResponse.json({ history, stats })
}
