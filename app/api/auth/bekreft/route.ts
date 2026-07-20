import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { ensureProfileForUser, safeNextPath } from '@/lib/auth-post-login'

// Innløser en e-postlenke (token_hash) og oppretter sesjonen.
//
// KUN POST — og det er hele poenget med ruten.
//
// Supabase sin egen /auth/v1/verify forbruker engangs-tokenet på GET. Verifisert
// 20. juli mot live-prosjektet: første GET gir sesjon, andre GET gir
// otp_expired. E-postskannere (Proton, Outlook, bedrifts-gateway) følger lenker
// automatisk før brukeren rekker å klikke, og brukte dermed opp lenken.
// Her skjer innløsningen først når brukeren selv trykker knappen på
// /auth/bekreft, som sender en POST. Skannere følger ikke POST-skjemaer, så et
// automatisk besøk på lenken forbruker ingenting.
//
// verifyOtp (token_hash) krever heller ingen PKCE-verifier, i motsetning til
// exchangeCodeForSession i /auth/callback. Lenken virker derfor i en HVILKEN SOM
// HELST nettleser — å be om lenken på PC og åpne e-posten på mobil fungerer nå.
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url)

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`auth-verify:${ip}`, 20, 60_000).success) {
    return NextResponse.redirect(`${origin}/login?error=rate_limit`, 303)
  }

  const form = await request.formData().catch(() => null)
  if (!form) {
    return NextResponse.redirect(`${origin}/login?error=link_invalid`, 303)
  }

  const tokenHash = String(form.get('token_hash') ?? '')
  const rawType = String(form.get('type') ?? '')
  const next = safeNextPath(String(form.get('next') ?? '/'))

  const ALLOWED: EmailOtpType[] = ['recovery', 'magiclink', 'signup', 'invite', 'email', 'email_change']
  const type = ALLOWED.includes(rawType as EmailOtpType) ? (rawType as EmailOtpType) : null

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=link_invalid`, 303)
  }

  // 303 slik at nettleseren gjør en GET på målet. NextResponse.redirect bruker
  // 307 som standard, som ville beholdt POST-metoden og truffet en side som
  // ikke svarer på POST.
  const response = NextResponse.redirect(`${origin}${next}`, 303)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })

  if (error || !data.session || !data.user) {
    console.error('[auth/bekreft] verifyOtp feilet:', error?.message ?? 'ingen sesjon')
    return NextResponse.redirect(`${origin}/login?error=link_invalid`, 303)
  }

  console.log('[auth/bekreft] sesjon ok, type:', type, 'user:', data.user.id)

  await ensureProfileForUser(data.user)

  return response
}
