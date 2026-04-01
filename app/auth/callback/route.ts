import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) return NextResponse.redirect(`${origin}${next}`)

  // Exchange PKCE code using anon client (code exchange doesn't need service role)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError || !data.session) {
    console.error('[auth/callback] exchangeCodeForSession failed:', exchangeError)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const { session, user } = data

  // Upsert profile using service role to bypass RLS entirely
  const { error: upsertError } = await supabaseAdmin.from('profiles').upsert({
    id: user.id,
    display_name: (user.user_metadata?.full_name as string | undefined)
      ?? user.email?.split('@')[0]
      ?? null,
    avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true })

  if (upsertError) {
    console.error('[auth/callback] profile upsert failed:', upsertError)
    // Non-fatal: continue to redirect so the user is still logged in
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
