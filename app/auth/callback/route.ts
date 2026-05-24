import { createServerClient } from '@supabase/ssr'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`auth-callback:${ip}`, 20, 60_000).success) {
    return NextResponse.redirect(new URL('/?error=rate_limit', request.url))
  }

  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    console.log('[auth/callback] no code in URL, redirecting to', next)
    return NextResponse.redirect(`${origin}${next}`)
  }

  // Pre-create the success redirect response so we can attach session cookies to it.
  // The setAll closure captures this variable — by the time Supabase calls setAll
  // (during exchangeCodeForSession), response is already assigned.
  let response = NextResponse.redirect(`${origin}${next}`)

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

  const { user } = data
  console.log('[auth/callback] session ok, user id:', user.id, 'email:', user.email)

  // Insert profile for new users only — never overwrite display_name on re-login.
  // Google users: seed display_name from full_name in metadata.
  // Magic link users: display_name stays null → AuthListener dispatches
  //   qk:name-required so the user is prompted to enter their real name.
  const now = new Date().toISOString()
  const initialDisplayName =
    (user.user_metadata?.full_name as string | undefined) ?? null

  const profilePayload = {
    id: user.id,
    display_name: initialDisplayName,
    avatar_color: null as string | null,
    last_seen_at: now,
  }
  console.log('[auth/callback] upserting profile:', profilePayload)

  // ignoreDuplicates: true → INSERT for new users, no-op for existing users
  // (preserves display_name set by the user after first login)
  const { error: upsertError } = await supabaseAdmin
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id', ignoreDuplicates: true })

  // Always refresh last_seen_at, even for returning users
  if (!upsertError) {
    await supabaseAdmin
      .from('profiles')
      .update({ last_seen_at: now })
      .eq('id', user.id)
  }

  if (upsertError) {
    console.error(
      '[auth/callback] profile upsert failed — code:', upsertError.code,
      'message:', upsertError.message,
      'details:', upsertError.details
    )
  } else {
    console.log('[auth/callback] profile upserted ok for user', user.id)
  }

  // Session is now stored in cookies on `response` — no URL hash needed.
  // createBrowserClient on the client will read the cookies and fire onAuthStateChange.
  return response
}
