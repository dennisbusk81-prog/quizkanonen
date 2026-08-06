import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { AUTH_LINK_RATE_LIMIT } from '@/lib/auth-rate-limit'
import { ensureProfileForUser, safeNextPath } from '@/lib/auth-post-login'
import { postLoginPath, welcomeOnboardingEnabled } from '@/lib/welcome-onboarding'

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
  // Delt grense med /auth/callback — se lib/auth-rate-limit.ts. IP er det
  // eneste vi har her: brukeren er per definisjon ikke innlogget ennå, så
  // per-bruker-nøkling (lib/play-rate-limit.ts) er ikke mulig på denne flaten.
  if (!(await rateLimitShared(`auth-verify:${ip}`, AUTH_LINK_RATE_LIMIT.limit, AUTH_LINK_RATE_LIMIT.windowMs)).success) {
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

  const { isNewUser } = await ensureProfileForUser(data.user)

  // Samme regel som /auth/callback, samme ene kilde. Dette er stien de fleste
  // ferske B2C-brukere faktisk kommer inn på: passord-signup og magic link går
  // begge via en e-postlenke, ikke via PKCE.
  //
  // Uten WELCOME_ONBOARDING_ENABLED er `target === next`, headeren røres ikke,
  // og responsen er bit-identisk med før — inkludert 303-statusen.
  const target = postLoginPath({
    isNewUser,
    next,
    enabled: welcomeOnboardingEnabled(process.env.WELCOME_ONBOARDING_ENABLED),
  })

  // Skriver på den eksisterende responsen: sesjons-cookiene fra verifyOtp ligger
  // allerede i den, og en ny NextResponse.redirect ville mistet dem.
  if (target !== next) {
    response.headers.set('location', `${origin}${target}`)
  }

  return response
}
