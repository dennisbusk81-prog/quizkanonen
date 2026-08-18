import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(req: NextRequest) {
  // Sak 2.3 — kun ratelimit når vi faktisk kan identifisere klienten. Uten
  // x-forwarded-for kan vi ikke skille klienter fra hverandre; å dele én global
  // bøtte ville latt tilfeldige brukere ta hverandres kvote og gi falske 429-er.
  // Da faller vi heller åpent (ingen ratelimit). Grensen er hevet 30 → 120/60s.
  const ip = req.headers.get('x-forwarded-for')
  const rlKey = `premium-status:${ip}`
  if (ip && !rateLimit(rlKey, 120, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 120, windowMs: 60_000 })
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
    .select('premium_status, premium_source, stripe_customer_id, org_premium_grace_until')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[premium-status] DB error:', error.code, error.message)
    return NextResponse.json({ isPremium: false }, { status: 500 })
  }

  // Grace period: brukere som mistet org-Premium beholder tilgang til grace utløper
  const graceActive = !!data?.org_premium_grace_until
    && new Date(data.org_premium_grace_until) > new Date()

  return NextResponse.json({
    isPremium: data?.premium_status === true || graceActive,
    premiumSource: data?.premium_source ?? null,
    hasStripeCustomer: !!data?.stripe_customer_id,
  })
}
