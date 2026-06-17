import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`premium-status:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ isPremium: false, error: 'For mange forespørsler' }, { status: 429 })
  }

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
    .select('premium_status, premium_source')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[premium-status] DB error:', error.code, error.message)
    return NextResponse.json({ isPremium: false }, { status: 500 })
  }

  return NextResponse.json({
    isPremium: data?.premium_status === true,
    premiumSource: data?.premium_source ?? null,
  })
}
