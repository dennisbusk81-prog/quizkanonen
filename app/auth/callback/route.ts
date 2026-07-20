import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { ensureProfileForUser, safeNextPath } from '@/lib/auth-post-login'

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
  if (!rateLimit(`auth-callback:${ip}`, 20, 60_000).success) {
    return NextResponse.redirect(new URL('/?error=rate_limit', request.url))
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

  await ensureProfileForUser(data.user)

  // Session is now stored in cookies on `response` — no URL hash needed.
  // createBrowserClient on the client will read the cookies and fire onAuthStateChange.
  return response
}
