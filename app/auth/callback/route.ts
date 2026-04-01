import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    console.log('[auth/callback] no code in URL, redirecting to', next)
    return NextResponse.redirect(`${origin}${next}`)
  }

  // Exchange PKCE code using anon client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError || !data.session) {
    console.error('[auth/callback] exchangeCodeForSession failed:', exchangeError?.message ?? 'no session')
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const { session, user } = data
  console.log('[auth/callback] session ok, user id:', user.id, 'email:', user.email)

  // Upsert profile — columns must match the actual profiles table:
  // id, display_name, avatar_color, created_at, last_seen_at
  const profilePayload = {
    id: user.id,
    display_name: (user.user_metadata?.full_name as string | undefined)
      ?? user.email?.split('@')[0]
      ?? null,
    avatar_color: null as string | null,
    last_seen_at: new Date().toISOString(),
  }
  console.log('[auth/callback] upserting profile:', profilePayload)

  const { error: upsertError } = await supabaseAdmin
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' })

  if (upsertError) {
    console.error('[auth/callback] profile upsert failed — code:', upsertError.code, 'message:', upsertError.message, 'details:', upsertError.details)
  } else {
    console.log('[auth/callback] profile upserted ok for user', user.id)
  }

  // Pass session to the browser via URL hash.
  // Supabase JS v2 detects access_token in the hash on init
  // (_isImplicitGrantCallback) regardless of configured flowType.
  const params = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: 'bearer',
    expires_in: String(session.expires_in),
  })

  return NextResponse.redirect(`${origin}${next}#${params.toString()}`)
}
