import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { AUTH_LINK_RATE_LIMIT } from '@/lib/auth-rate-limit'
import { ensureProfileForUser, safeNextPath } from '@/lib/auth-post-login'
import { postLoginPath, welcomeOnboardingEnabled } from '@/lib/welcome-onboarding'

// PKCE-callback. Etter 20. juli er dette i praksis Google OAuth-stien.
//
// E-postlenker (magic link, «sett passord», kontobekreftelse) går nå via
// /auth/bekreft → POST /api/auth/bekreft, som bruker token_hash i stedet.
// Grunnen: PKCE binder koden til nettleseren som BA om lenken, via en
// code_verifier-cookie. Ba du om lenken på PC og åpnet e-posten på mobil,
// fantes ikke cookien, exchangeCodeForSession feilet, og brukeren havnet her
// på /login?error=auth_failed. For OAuth er den bindingen uproblematisk —
// der skjer hele flyten i samme nettleser per definisjon.
//
// Ruten beholdes uendret i oppførsel for OAuth, og fortsetter å virke for
// e-postlenker som allerede er sendt ut med gammel mal.
export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `auth-callback:${ip}`
  if (!(await rateLimitShared(rlKey, AUTH_LINK_RATE_LIMIT.limit, AUTH_LINK_RATE_LIMIT.windowMs)).success) {
    logRateLimitHit(rlKey, { lag: 'delt', ...AUTH_LINK_RATE_LIMIT })
    // Målet må være /login, ikke forsiden: `?error=` leses kun av AuthForm, som
    // lever på /login og i AuthModal. Fram til 31. juli 2026 pekte denne til
    // `/?error=rate_limit`, og forsiden leser ikke parameteren i det hele tatt —
    // brukeren landet uinnlogget på forsiden uten en eneste forklaring.
    // /api/auth/bekreft har hele tiden gjort dette riktig, og linkErrorMessage
    // har allerede en `rate_limit`-case med ferdig tekst.
    //
    // Merk at `x-forwarded-for` gjør at en delt utgangs-IP (et kontor, en
    // mobiloperatør) teller som ÉN klient mot grensen — så dette treffer ikke
    // bare misbruk, men også en gruppe ekte folk som logger inn samtidig.
    // Desto viktigere at de får se hvorfor. Grensen ble hevet 20 → 60/min
    // 5. august 2026 nettopp av den grunn; se lib/auth-rate-limit.ts. Til
    // forskjell fra spillestien kan den ikke nøkles på bruker-id — her finnes
    // ingen verifisert bruker ennå.
    return NextResponse.redirect(new URL('/login?error=rate_limit', request.url))
  }

  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // safeNextPath stopper åpen redirect: next=`@evil.com` ga tidligere
  // `https://quizkanonen.no@evil.com`, som nettleseren sender til evil.com.
  const next = safeNextPath(searchParams.get('next'))

  if (!code) {
    console.log('[auth/callback] no code in URL, redirecting to', next)
    return NextResponse.redirect(`${origin}${next}`)
  }

  // Pre-create the success redirect response so we can attach session cookies to it.
  // The setAll closure captures this variable — by the time Supabase calls setAll
  // (during exchangeCodeForSession), response is already assigned.
  const response = NextResponse.redirect(`${origin}${next}`)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // The PKCE code verifier was stored in cookies by createBrowserClient
          // when the OAuth flow was initiated on the client side.
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write session tokens into the redirect response as cookies.
          // The browser will send them on every subsequent request.
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError || !data.session) {
    console.error(
      '[auth/callback] exchangeCodeForSession failed:',
      exchangeError?.message ?? 'no session'
    )
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  console.log('[auth/callback] session ok, user id:', data.user.id, 'email:', data.user.email)

  const { isNewUser } = await ensureProfileForUser(data.user)

  // Velkomstsiden for ferske B2C-brukere. Regelen bor i lib/welcome-onboarding.ts
  // slik at denne ruten og /api/auth/bekreft ikke kan drifte fra hverandre —
  // de to har allerede måttet rettes hver for seg én gang (rate_limit-redirecten
  // pekte feil sted her i flere uker mens bekreft gjorde det riktig).
  //
  // Uten WELCOME_ONBOARDING_ENABLED returnerer postLoginPath alltid `next`, og
  // linjene under er da et rent no-op: `target === next`, ingen header røres,
  // responsen er bit-identisk med den ruten returnerte før denne endringen.
  const target = postLoginPath({
    isNewUser,
    next,
    enabled: welcomeOnboardingEnabled(process.env.WELCOME_ONBOARDING_ENABLED),
  })

  // Location settes på den EKSISTERENDE responsen. `response` ble opprettet før
  // exchangeCodeForSession nettopp fordi setAll-closuren skriver sesjons-
  // cookiene inn i den — en ny NextResponse.redirect her ville kastet dem.
  if (target !== next) {
    response.headers.set('location', `${origin}${target}`)
  }

  // Session is now stored in cookies on `response` — no URL hash needed.
  // createBrowserClient on the client will read the cookies and fire onAuthStateChange.
  return response
}
