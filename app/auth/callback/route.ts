import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) return NextResponse.redirect(`${origin}${next}`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const { session, user } = data

  // Upsert profile using the user's own access token (satisfies RLS)
  const authedClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${session.access_token}` } } }
  )
  await authedClient.from('profiles').upsert({
    id: user.id,
    display_name: (user.user_metadata?.full_name as string | undefined)
      ?? user.email?.split('@')[0]
      ?? null,
    avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true })

  // Pass session to the browser via URL hash.
  // Supabase JS v2 checks window.location.hash for access_token on init
  // (via _isImplicitGrantCallback) regardless of configured flowType.
  const params = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: 'bearer',
    expires_in: String(session.expires_in),
  })

  return NextResponse.redirect(`${origin}${next}#${params.toString()}`)
}
