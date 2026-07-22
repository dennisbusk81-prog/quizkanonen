import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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
          // Write new cookie values into the request object first (for downstream
          // middleware), then recreate the response with the updated cookies.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
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
