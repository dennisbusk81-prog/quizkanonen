import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { isTrialEligible, parseTrialDays } from '@/lib/trial-offer'

// Leser de to opplysningene klientflatene trenger for å tilby den gratis
// prøveperioden ærlig: hvor lang den er, og om DENNE kontoen kan få den.
//
// HVORFOR EN RUTE OG IKKE ET KLIENT-OPPSLAG
// `profiles` er stengt for `anon` på GRANT-nivå i prod (målt 12. august 2026:
// `42501 permission denied for table profiles`), og hva `authenticated` får se
// er ikke verifiserbart uten en ekte sesjon. Rettighetsvisningen skal ikke
// hvile på en policy vi ikke kan bekrefte. `founders_new_trial_days` er
// riktignok offentlig lesbar via site_settings, men å hente den ett sted og
// eligibility et annet ville gitt to kilder til én beslutning.
//
// AUTH ER VALGFRI, og det er hele poenget. Uten token svarer vi
// `eligible: null` = UKJENT, ikke `false`. Utloggede skal se tilbudet og møte
// innloggingen; det er serveren (founders-activate) som er gaten. Samme
// behandling ved et feilet profiloppslag: «vi vet ikke» er et ærligere svar
// enn å skjule tilbudet for en kvalifisert bruker.
//
// GET, og bruker-id-en kommer utelukkende fra det verifiserte tokenet — samme
// form som /api/profile/has-password. Det finnes ingen parameter en kaller kan
// bruke til å peke svaret mot en annen konto.
export async function GET(request: NextRequest) {
  // Samme mønster som has-password/premium-status: brems kun når vi faktisk kan
  // skille klienter fra hverandre. Uten x-forwarded-for ville alle delt én
  // bøtte, og tilfeldige brukere kunne spist hverandres kvote.
  const ip = request.headers.get('x-forwarded-for')
  if (ip && !rateLimit(`trial-offer:${ip}`, 60, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const { data: settingRow, error: settingError } = await supabaseAdmin
    .from('site_settings')
    .select('value')
    .eq('key', 'founders_new_trial_days')
    .maybeSingle()

  if (settingError) {
    console.error('[premium/trial-offer] kunne ikke lese founders_new_trial_days:', settingError.message)
  }

  // null her betyr «ingen dagangivelse» → flaten viser sin vanlige
  // Premium-tekst. Det er samme utfall som founders-activate sitt fail-closed:
  // uten et bestemt tall skal ingen få lovet en lengde.
  const trialDays = parseTrialDays(settingRow?.value)

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ trialDays, eligible: null })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ trialDays, eligible: null })
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, has_used_trial, org_premium_grace_until')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile) {
    console.error(
      '[premium/trial-offer] kunne ikke lese profilen:',
      profileError?.message ?? 'ingen profilrad for bruker ' + user.id,
    )
    // «Vet ikke» — ikke «ikke kvalifisert». Knappen vises, og founders-activate
    // (som er fail-CLOSED på nøyaktig samme oppslag) avviser om den må.
    return NextResponse.json({ trialDays, eligible: null })
  }

  // Samme grace-regel som /api/profile/premium-status: en bruker som mistet
  // org-Premium har fortsatt dekning ut grace-perioden, og skal ikke tilbys en
  // prøveperiode oppå den.
  const graceActive = !!profile.org_premium_grace_until
    && new Date(profile.org_premium_grace_until) > new Date()

  const eligible = isTrialEligible({
    isPremium: profile.premium_status === true || graceActive,
    hasUsedTrial: profile.has_used_trial === true,
  })

  return NextResponse.json({ trialDays, eligible })
}
