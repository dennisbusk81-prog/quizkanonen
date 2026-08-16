import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { osloDateString, osloWallClockToUtcIso } from '@/lib/oslo-time'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export const dynamic = 'force-dynamic'

// Returns org-specific quiz open/close times for the authenticated user,
// combined with the quiz's date so the client can compare against now().
export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`my-quiz-times:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })

  const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken)
  if (!user) return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })

  const quizId = request.nextUrl.searchParams.get('quizId')
  if (!quizId) return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })

  // Get the quiz's global window — used both as base date and as clamp bounds
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('opens_at, closes_at')
    .eq('id', quizId)
    .maybeSingle()

  // closes_at er nullable i skjemaet (en quiz kan stå åpen uten sluttid). Uten
  // den finnes det ingen dato å feste org-tiden til, og org-vinduet kan heller
  // ikke klemmes mot noe — da er svaret «ingen org-spesifikke tider».
  if (!quiz || !quiz.closes_at || !quiz.opens_at) {
    return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })
  }

  // Find ALL of the user's org memberships (a user may belong to several)
  const { data: memberships } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })
  }

  const orgIds = memberships.map(m => m.organization_id)

  // Only orgs that actually set a custom open/close time matter here
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('name, org_quiz_opens_at, org_quiz_closes_at')
    .in('id', orgIds)

  const orgsWithTimes = (orgs ?? []).filter(
    o => o.org_quiz_opens_at || o.org_quiz_closes_at
  )

  if (orgsWithTimes.length === 0) {
    return NextResponse.json({ orgOpensAt: null, orgClosesAt: null, orgName: null })
  }

  // Combine the quiz date (from closes_at, i NORSK kalender) with an org TIME
  // ("HH:MM" eller "HH:MM:SS") → full ISO instant. Org-tiden er en norsk
  // veggklokke, ikke UTC — fram til 1. august 2026 ble den limt sammen som
  // `...Z` og lest som UTC, slik at "15:00" ble 17:00 norsk tid om sommeren.
  // Se lib/oslo-time.ts.
  const quizDate = osloDateString(quiz.closes_at)
  const combine = (time: string | null): string | null =>
    time && quizDate ? osloWallClockToUtcIso(quizDate, time) : null

  const globalOpensMs  = new Date(quiz.opens_at).getTime()
  const globalClosesMs = new Date(quiz.closes_at).getTime()

  // Clamp each org's window so it can never be WIDER than the global window:
  //   effectiveOpens  = max(orgOpens,  globalOpens)   — opens no earlier
  //   effectiveCloses = min(orgCloses, globalCloses)  — closes no later
  // A side the org didn't set stays null (no org-specific narrowing there).
  const computed = orgsWithTimes.map(o => {
    const rawOpens  = combine(o.org_quiz_opens_at)
    const rawCloses = combine(o.org_quiz_closes_at)

    const effectiveOpensAt = rawOpens
      ? new Date(Math.max(new Date(rawOpens).getTime(), globalOpensMs)).toISOString()
      : null
    const effectiveClosesAt = rawCloses
      ? new Date(Math.min(new Date(rawCloses).getTime(), globalClosesMs)).toISOString()
      : null

    // For ranking the strictest org, treat a missing close as the global close.
    const closeForCompare = effectiveClosesAt
      ? new Date(effectiveClosesAt).getTime()
      : globalClosesMs

    return { name: o.name, effectiveOpensAt, effectiveClosesAt, closeForCompare }
  })

  // If the user is in several orgs with custom times, pick the one with the
  // earliest effective close (the strictest deadline applies to them).
  computed.sort((a, b) => a.closeForCompare - b.closeForCompare)
  const chosen = computed[0]

  return NextResponse.json({
    orgOpensAt: chosen.effectiveOpensAt,
    orgClosesAt: chosen.effectiveClosesAt,
    orgName: chosen.name,
  })
}
