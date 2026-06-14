import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-settings:${ip}`, 20, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })
  }

  let body: { allow_global_league?: boolean; admin_can_see_answers?: boolean; weekly_report_timing?: string; org_quiz_opens_at?: string | null; org_quiz_closes_at?: string | null }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const WEEKLY_TIMINGS = ['after_quiz', 'saturday_morning', 'monday_morning']
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

  const update: Record<string, boolean | string | null> = {}
  if (typeof body.allow_global_league === 'boolean') update.allow_global_league = body.allow_global_league
  if (typeof body.admin_can_see_answers === 'boolean') update.admin_can_see_answers = body.admin_can_see_answers
  if (typeof body.weekly_report_timing === 'string' && WEEKLY_TIMINGS.includes(body.weekly_report_timing)) {
    update.weekly_report_timing = body.weekly_report_timing
  }
  if ('org_quiz_opens_at' in body) {
    update.org_quiz_opens_at = (body.org_quiz_opens_at && TIME_RE.test(body.org_quiz_opens_at)) ? body.org_quiz_opens_at : null
  }
  if ('org_quiz_closes_at' in body) {
    update.org_quiz_closes_at = (body.org_quiz_closes_at && TIME_RE.test(body.org_quiz_closes_at)) ? body.org_quiz_closes_at : null
  }

  // Når begge tidspunkter settes samtidig (admin-UI sender alltid begge):
  // åpning må være før stenging. "HH:MM"-strenger kan sammenlignes leksikalsk.
  if (
    typeof update.org_quiz_opens_at === 'string' &&
    typeof update.org_quiz_closes_at === 'string' &&
    update.org_quiz_opens_at >= update.org_quiz_closes_at
  ) {
    return NextResponse.json({ error: 'Åpningstid må være før stengetid.' }, { status: 400 })
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Ingenting å oppdatere' }, { status: 400 })
  }

  await supabaseAdmin.from('organizations').update(update).eq('id', org.id)

  return NextResponse.json({ ok: true })
}
