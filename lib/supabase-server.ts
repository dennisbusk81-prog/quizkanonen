import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-side Supabase client for Server Components and Route Handlers.
 * Reads and writes session via cookies so SSR can detect logged-in users.
 * Middleware handles token refresh; the setAll try/catch handles the case
 * where this is called from a Server Component (which cannot set cookies).
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components cannot set cookies.
            // Middleware refreshes them on every request instead.
          }
        },
      },
    }
  )
}
