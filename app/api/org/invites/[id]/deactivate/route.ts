import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `org-invite-deactivate:${ip}`
  if (!rateLimit(rlKey, 20, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 20, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id } = await params

  // Get invite and verify admin
  const { data: invite } = await supabaseAdmin
    .from('organization_invites')
    .select('organization_id')
    .eq('id', id)
    .maybeSingle()

  if (!invite) return NextResponse.json({ error: 'Invitasjon ikke funnet' }, { status: 404 })

  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', invite.organization_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  // Låst org: invitasjonsadministrasjon hører til det betalte panelet. Denne
  // handlingen er riktignok reduserende, men den hører til samme flate som
  // opprettelsen — og admin-UI-et er uansett erstattet av lås-skjermen.
  const lock = await requireUnlockedOrg({ id: invite.organization_id })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  await supabaseAdmin
    .from('organization_invites')
    .update({ is_active: false })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
