import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

// Setter profiles.has_password = true etter et vellykket passord-signup.
//
// Må kjøres server-side (service-role): på signup-tidspunktet finnes det hverken
// sesjon eller profilrad ennå (Confirm email er PÅ → signUp gir ingen sesjon, og
// profilraden opprettes først i /auth/callback når brukeren bekrefter e-posten).
// Vi kan derfor ikke gjøre en klient-side, innlogget skriving.
//
// Upsert oppretter raden hvis den ikke finnes. Fremmednøkkelen profiles.id →
// auth.users(id) gjør at bare EKTE bruker-id-er kan markeres (falske id-er gir
// FK-feil). Ruten setter KUN true, aldri false.
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`mark-password:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  let body: { userId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const userId = body.userId?.trim()
  if (!userId) {
    return NextResponse.json({ error: 'Mangler userId' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: userId, has_password: true }, { onConflict: 'id' })

  if (error) {
    console.error('[auth/mark-password] upsert feilet for', userId, ':', error.message)
    return NextResponse.json({ error: 'Kunne ikke lagre' }, { status: 500 })
  }

  console.log('[auth/mark-password] has_password=true satt for', userId)
  return NextResponse.json({ ok: true })
}
