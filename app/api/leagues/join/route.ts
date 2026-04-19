import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const bodySchema = z.object({
  invite_token: z.string().trim().min(1, 'invite_token er påkrevd'),
})

// POST /api/leagues/join — bli med i liga via invite_token
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`league-join:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig JSON.' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((e) => e.message).join(', ') }, { status: 422 })
  }

  const { invite_token } = parsed.data

  // Finn liga via invite_token
  const { data: league } = await supabaseAdmin
    .from('leagues')
    .select('id, name, slug')
    .eq('invite_token', invite_token)
    .maybeSingle()

  if (!league) {
    return NextResponse.json({ error: 'Ugyldig invitasjonslenke. Sjekk at den er riktig og prøv igjen.' }, { status: 404 })
  }

  // Sjekk at brukeren ikke allerede er medlem
  const { data: existing } = await supabaseAdmin
    .from('league_members')
    .select('user_id')
    .eq('league_id', league.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Du er allerede medlem av denne ligaen.', slug: league.slug }, { status: 409 })
  }

  // Sjekk at ligaen ikke er full (maks 10 medlemmer)
  const { count: memberCount } = await supabaseAdmin
    .from('league_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('league_id', league.id)

  if ((memberCount ?? 0) >= 10) {
    return NextResponse.json({ error: 'Denne ligaen er full (maks 10 medlemmer).' }, { status: 403 })
  }

  const { error: insertError } = await supabaseAdmin
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  if (insertError) {
    return NextResponse.json({ error: 'Kunne ikke melde deg inn i ligaen.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, slug: league.slug, name: league.name })
}
