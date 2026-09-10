import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function PATCH(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `profile-prefs:${ip}`
  if (!rateLimit(rlKey, 20, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 20, windowMs: 60_000 })
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

  const update: Record<string, unknown> = {}
  if (typeof body.email_reminders === 'boolean') update.email_reminders = body.email_reminders
  if (typeof body.email_reengagement === 'boolean') update.email_reengagement = body.email_reengagement
  if (typeof body.email_duel_notifications === 'boolean') update.email_duel_notifications = body.email_duel_notifications

  // Nickname — eneste regel er maks 20 tegn. Ingen navnevalidering. Tom = null.
  if (body.nickname !== undefined) {
    if (body.nickname !== null && typeof body.nickname !== 'string') {
      return NextResponse.json({ error: 'Ugyldig kallenavn' }, { status: 422 })
    }
    const trimmed = (body.nickname as string | null)?.trim() ?? ''
    if (trimmed.length > 20) {
      return NextResponse.json({ error: 'Kallenavn kan maks være 20 tegn' }, { status: 422 })
    }
    update.nickname = trimmed === '' ? null : trimmed
  }

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
