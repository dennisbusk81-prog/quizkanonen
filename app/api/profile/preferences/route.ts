import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function PATCH(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`profile-prefs:${ip}`, 20, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const update: Record<string, boolean> = {}
  if (typeof body.email_reminders === 'boolean') update.email_reminders = body.email_reminders
  if (typeof body.email_reengagement === 'boolean') update.email_reengagement = body.email_reengagement
  if (typeof body.email_duel_notifications === 'boolean') update.email_duel_notifications = body.email_duel_notifications

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Ingen gyldige felter' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', user.id)

  if (error) {
    console.error('[api/profile/preferences] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
