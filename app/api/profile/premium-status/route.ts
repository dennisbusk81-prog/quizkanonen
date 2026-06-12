import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ isPremium: false }, { status: 401 })
  }

  // Valider token og hent bruker-ID
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ isPremium: false }, { status: 401 })
  }

  // Hent premium_status med service role — omgår RLS
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('premium_status')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[premium-status] DB error:', error.code, error.message)
    return NextResponse.json({ isPremium: false }, { status: 500 })
  }

  return NextResponse.json({ isPremium: data?.premium_status === true })
}
