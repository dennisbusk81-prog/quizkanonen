import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { filterSessionDeletions } from '@/lib/middleware-cookie-guard'

/**
 * Supabase SSR middleware — refreshes the session cookie on every request
 * so Server Components always receive a valid, up-to-date auth token.
 *
 * IMPORTANT: Do not add logic between createServerClient and getUser() that
 * depends on the session; getUser() is what triggers the token refresh.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // VAKT: middleware skal aldri slette sesjons-cookien. Feiler en
          // token-fornyelse med en status auth-js ikke regner som
          // infrastruktur (500, 429), kaller biblioteket _removeSession() og
          // sender slette-cookies hit — en Supabase som svarer 500 ville
          // dermed logget ut alle innloggede, stille og med 200 OK.
          // Se lib/middleware-cookie-guard.ts for hvorfor filteret må stå FØR
          // begge skrivingene under, og for chunk-krymping-unntaket.
          const { kept, dropped } = filterSessionDeletions(cookiesToSet)

          if (dropped.length > 0) {
            // Eneste sporet av at vakten grep. Prefikset er med vilje unikt og
            // greppbart — det er slik den kan verifiseres i Vercel-loggen.
            console.warn(
              '[middleware-cookie-guard] blokkerte sletting av sesjons-cookie:',
              dropped.map(({ name }) => name).join(', ')
            )
          }

          // Ingenting igjen å skrive: la responsen stå urørt. Da beholder vi
          // objektet fra linje 13 i stedet for å bytte det ut med et identisk
          // et, og setAll blir uten sideeffekt når alt ble blokkert.
          if (kept.length === 0) return

          // Nye cookie-verdier skrives FØRST inn i request-objektet. Det er
          // ikke kosmetikk: NextResponse.next({ request }) videresender de
          // muterte request-headerne til server-renderingen nedstrøms, så det
          // er denne skrivingen app/page.tsx sin getSession() faktisk ser.
          kept.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          kept.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshes the session if expired. Must not be removed or moved.
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  // /api/* er bevisst ekskludert: ingen API-rute leser cookie-sesjonen
  // (ingen route.ts bruker createSupabaseServer), så ingen trenger middleware
  // sin token-refresh. Alle sensitive API-ruter reverifiserer selv — via
  // supabaseAdmin.auth.getUser(token) på Bearer-token, verifyAdminRequest, eller
  // CRON_SECRET. Å la getUser() kjøre her påla derfor kun en overflødig GoTrue-
  // round-trip på hver av de 118 API-rutene (varme stier: premium-status,
  // my-orgs, quiz submit/questions/standings), uten noen sikkerhetsverdi.
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
