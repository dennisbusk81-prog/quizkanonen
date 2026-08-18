import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { validateOrgName } from '@/lib/org-name'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `org-settings:${ip}`
  if (!rateLimit(rlKey, 20, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 20, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, onboarding_completed_at')
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

  // Låst org: bedriftsnavnet står i alle e-poster vi sender på bedriftens vegne,
  // og quiz-tidene styrer et produkt som ikke lenger betales for.
  const lock = await requireUnlockedOrg({ slug })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  let body: { name?: unknown; allow_global_league?: boolean; admin_can_see_answers?: boolean; weekly_report_timing?: string; org_quiz_opens_at?: string | null; org_quiz_closes_at?: string | null; onboarding_completed?: boolean }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const WEEKLY_TIMINGS = ['after_quiz', 'saturday_morning', 'monday_morning']
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

  const update: Record<string, boolean | string | null> = {}

  // Bedriftsnavn. Samme validering som ved opprettelse (org-checkout og
  // org-founders-activate) — navnet havner i e-poster til både medlemmer og
  // admin, så tegnsettet skal være like snevert her som der.
  let previousName: string | null = null
  if ('name' in body) {
    const nameCheck = validateOrgName(body.name)
    if (!nameCheck.ok) {
      return NextResponse.json({ error: nameCheck.error }, { status: 400 })
    }
    if (nameCheck.value !== org.name) {
      update.name = nameCheck.value
      previousName = org.name
    }
  }

  // Oppsettet på /org/[slug]/velkommen er fullført. Stemples KUN én gang: en
  // admin som senere går frivillig til velkomstsiden igjen skal ikke flytte
  // tidspunktet, for da slutter feltet å svare på «når ble dette gjort».
  // Kolonnen er den eneste varige måten å vite at oppsettet er unnagjort —
  // se lib/org-onboarding.ts for hvorfor svarene selv ikke duger.
  if (body.onboarding_completed === true && !org.onboarding_completed_at) {
    update.onboarding_completed_at = new Date().toISOString()
  }

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
    // Et navn som er sendt inn uendret er ikke en feil — da er det ingenting å
    // gjøre, og admin skal ikke få en rød melding for å ha lagret det samme.
    if ('name' in body) return NextResponse.json({ ok: true, unchanged: true })
    return NextResponse.json({ error: 'Ingenting å oppdatere' }, { status: 400 })
  }

  // Feilsjekk på skrivingen. Denne manglet helt fram til 29. juli 2026: ruten
  // svarte { ok: true } uansett utfall, så panelet viste «Innstilling lagret»
  // også når ingenting ble lagret.
  const { error: updateErr } = await supabaseAdmin
    .from('organizations')
    .update(update)
    .eq('id', org.id)

  if (updateErr) {
    console.error(`[org-settings] oppdatering feilet — org=${org.id}:`, updateErr.message)
    return NextResponse.json({ error: 'Kunne ikke lagre. Prøv igjen.' }, { status: 500 })
  }

  // Navneendring spores med både gammelt og nytt navn. Navnet står i alle
  // e-poster vi sender på bedriftens vegne, så «hvem endret det, fra hva, når»
  // er det eneste sporet hvis noen lurer i ettertid.
  if (previousName !== null) {
    try {
      const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
        user_id: user.id,
        action_type: 'org_name_changed',
        scope_type: 'organization',
        scope_id: org.id,
        details: { fra: previousName, til: update.name },
      })
      if (logErr) console.error('[org-settings] admin_actions-logging feilet', org.id, logErr.message)
    } catch (err) {
      console.error('[org-settings] admin_actions-logging kastet', org.id, err)
    }
  }

  return NextResponse.json({ ok: true })
}
