import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { filterSessionDeletions } from '@/lib/middleware-cookie-guard'
import { withTimeout } from '@/lib/with-timeout'

// Frist for getUser(). Dimensjonert mot BEGGE grensene målt/lest 16. august:
//   • Vercels middleware-stopp: 25 s (målt i loggen 14. august — «did not
//     return an initial response within 25s»).
//   • auth-js sitt eget retry-budsjett: 30 s (AUTO_REFRESH_TICK_DURATION_MS).
//     Merk at budsjettet KUN gjelder når GoTrue svarer med feil — henger
//     kallet uten svar, har auth-js ingen fetch-timeout i det hele tatt.
// Nedad: auth-js sine forsøk faller kumulativt på 0/200/600/1400/3000 ms,
// så 3000 lar ~fire forsøk fullføre (ekte blaff-toleranse) og kutter før
// backoffen blir sekunder. Normal getUser-latens ligger to størrelsesordener
// under — grensen kan ikke fyre på ordinær jitter.
const AUTH_TIMEOUT_MS = 3000

/**
 * Supabase SSR middleware — refreshes the session cookie on every request
 * so Server Components always receive a valid, up-to-date auth token.
 *
 * IMPORTANT: Do not add logic between createServerClient and getUser() that
 * depends on the session; getUser() is what triggers the token refresh.
 *
 * Får middleware IKKE svar fra Supabase (timeout, blokkert utlogging, kast),
 * settes request-headeren `x-qk-auth: unknown` og forespørselen slippes
 * videre med cookiene urørt. En timeout er «ukjent», aldri «utlogget» —
 * samme prinsipp som lib/has-settled-plays.ts. app/page.tsx leser headeren
 * og hopper da over sitt eget getSession()-kall (som ellers ville utløst
 * nøyaktig samme hengende refresh, med 300 s-budsjettet i render i stedet).
 */
export async function middleware(request: NextRequest) {
  // `x-qk-auth` er VÅRT interne signal fra middleware til render. Strippes
  // ALLTID fra innkommende forespørsler, før noen respons opprettes: hvem som
  // helst kan sende headeren utenfra, og selv om verste utfall bare er at
  // avsenderen skjuler innloggingsknappene for seg selv, skal en klient aldri
  // kunne sette et internt signal.
  request.headers.delete('x-qk-auth')

  let supabaseResponse = NextResponse.next({ request })

  // Forsegles ved timeout. `supabaseResponse` er en let som setAll
  // reassigner — et tapende getUser()-kall kan lande sekunder ETTER at
  // timeout-responsen er returnert og ellers kalle setAll på en respons som
  // allerede er sendt. Etter forsegling er setAll et no-op med loggspor.
  let sealed = false

  // Settes av setAll når vakten blokkerte en sletting: fornyelsen FEILET
  // ikke-retryable (500/429). Da vet vi ikke om sesjonen er gyldig — og
  // render må ikke spørre selv, for getSession() på et utløpt token ville
  // gjentatt nøyaktig samme feilende kall. Samme «ukjent»-utfall som timeout.
  let blockedDeletion = false

  // Cookies som faktisk ble skrevet før et eventuelt ukjent-utfall. Trengs
  // fordi ukjent-stien bygger en FERSK respons: rakk en fornyelse å fullføre
  // (refresh ok, men /user-kallet hang etterpå), ligger det nye tokenet her —
  // og kastes Set-Cookie da, står nettleseren igjen med et rotert, ubrukelig
  // refresh-token.
  const wrote: { name: string; value: string; options: CookieOptions }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          if (sealed) {
            // Timeout-responsen er allerede sendt — det tapende kallet får
            // ikke skrive på den. Cookiene i nettleseren står da urørt, som
            // er nøyaktig hva timeout-stien lover.
            console.warn(
              '[middleware-auth-timeout] setAll etter forsegling ignorert'
            )
            return
          }

          // VAKT: middleware skal aldri slette sesjons-cookien. Feiler en
          // token-fornyelse med en status auth-js ikke regner som
          // infrastruktur (500, 429), kaller biblioteket _removeSession() og
          // sender slette-cookies hit — en Supabase som svarer 500 ville
          // dermed logget ut alle innloggede, stille og med 200 OK.
          // Se lib/middleware-cookie-guard.ts for hvorfor filteret må stå FØR
          // begge skrivingene under, og for chunk-krymping-unntaket.
          const { kept, dropped } = filterSessionDeletions(cookiesToSet)

          if (dropped.length > 0) {
            blockedDeletion = true
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
          wrote.push(...kept)
        },
      },
    }
  )

  // Refreshes the session if expired. Must not be removed or moved.
  const outcome = await withTimeout(supabase.auth.getUser(), {
    ms: AUTH_TIMEOUT_MS,
    // Forsegles i samme tick som utfallet avgjøres — før noen kaller kan
    // rekke å røre responsen.
    onTimeout: () => {
      sealed = true
    },
  })

  // Tre veier til «ukjent», alle med cookiene urørt:
  //   • timeout        — GoTrue svarte ikke innen fristen
  //   • blockedDeletion — GoTrue svarte, men med en status som ville slettet
  //     sesjonen (500/429); vakten blokkerte, og gyldigheten er dermed uavklart
  //   • kast           — getUser() rejectet (skal ikke skje: auth-js pakker
  //     nettverksfeil inn som returverdier; et kast er en uventet bug, og før
  //     denne endringen ville det gitt MIDDLEWARE_INVOCATION_FAILED 500)
  // Merk at et VELLYKKET getUser med `user: null` (anonym besøkende) gir
  // outcome.ok === true og går den vanlige veien — anonyme er «gjest», ikke
  // «ukjent».
  if (!outcome.ok || blockedDeletion) {
    if (!outcome.ok && outcome.timedOut) {
      console.warn(
        `[middleware-auth-timeout] getUser() svarte ikke innen ${AUTH_TIMEOUT_MS} ms — slipper videre som ukjent`
      )
    }
    request.headers.set('x-qk-auth', 'unknown')
    const unknownResponse = NextResponse.next({ request })
    // Ta med cookies som alt var skrevet (se `wrote`) — den ferske responsen
    // starter ellers uten dem.
    wrote.forEach(({ name, value, options }) =>
      unknownResponse.cookies.set(name, value, options)
    )
    return unknownResponse
  }

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
