import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'

// POST /api/profile/founders-farewell-seen
// Stempler profiles.founders_farewell_dismissed_at for den innloggede brukeren
// — det varige «flaten er lukket»-merket for founders-farvel-flaten. Kalles av
// alle tre lukkeveiene i FoundersFarewellBanner (X, «Ikke nå», Premium-CTA).
//
// Bevisste valg:
//   • Skriver kun egen rad (id fra verifisert token), og kun der verdien er
//     NULL — første stempel bevares, gjentatte kall er no-op. Ingen gate på
//     has_used_trial: et stempel for en bruker utenfor målgruppen er harmløst
//     (kolonnen skjuler bare en flate vedkommende uansett aldri ser).
//   • In-memory rate-limit (lag 1) holder: konsekvensen av misbruk er å
//     stemple sin EGEN rad, som kallet gjør uansett.
// Lese-/lettskriv-rute: samme maxDuration-begrunnelse som league-preference.
export const maxDuration = 15

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `farewell-seen:${ip}`
  if (!rateLimit(rlKey, 20, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 20, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { error: updateErr } = await supabaseAdmin
    .from('profiles')
    .update({ founders_farewell_dismissed_at: new Date().toISOString() })
    .eq('id', user.id)
    .is('founders_farewell_dismissed_at', null)

  if (updateErr) {
    console.error('[farewell-seen] DB error:', updateErr.code, updateErr.message)
    return NextResponse.json({ error: 'Kunne ikke lagre' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
