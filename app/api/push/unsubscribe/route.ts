import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function DELETE(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`push-unsubscribe:${ip}`, 10, 60_000)
  if (!rl.success) return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const body = await request.json()
  const { endpoint } = body as { endpoint: string }
  if (!endpoint) return NextResponse.json({ error: 'Mangler endpoint' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', user.id)

  if (error) {
    console.error('[push/unsubscribe]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
