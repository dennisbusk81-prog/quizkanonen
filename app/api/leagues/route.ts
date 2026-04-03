import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

function toSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `${base}-${suffix}`
}

// GET /api/leagues — hent alle ligaer innlogget bruker er med i
export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`leagues-get:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // Hent ligaer brukeren er medlem av, med antall medlemmer
  const { data: memberships, error } = await supabaseAdmin
    .from('league_members')
    .select('league_id')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Kunne ikke hente ligaer.' }, { status: 500 })

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ leagues: [] })
  }

  const leagueIds = memberships.map((m) => m.league_id)

  const { data: leagues, error: leaguesError } = await supabaseAdmin
    .from('leagues')
    .select('id, name, slug, owner_id, invite_token, reset_at, created_at')
    .in('id', leagueIds)
    .order('created_at', { ascending: false })

  if (leaguesError) return NextResponse.json({ error: 'Kunne ikke hente ligaer.' }, { status: 500 })

  // Hent antall medlemmer per liga
  const { data: memberCounts, error: countError } = await supabaseAdmin
    .from('league_members')
    .select('league_id')
    .in('league_id', leagueIds)

  if (countError) return NextResponse.json({ error: 'Kunne ikke hente ligaer.' }, { status: 500 })

  const countMap = new Map<string, number>()
  for (const m of memberCounts ?? []) {
    countMap.set(m.league_id, (countMap.get(m.league_id) ?? 0) + 1)
  }

  const result = (leagues ?? []).map((l) => ({
    ...l,
    is_owner: l.owner_id === user.id,
    member_count: countMap.get(l.id) ?? 0,
  }))

  return NextResponse.json({ leagues: result })
}

const createSchema = z.object({
  name: z.string().trim().min(2, 'Navn må ha minst 2 tegn').max(60, 'Navn kan maks ha 60 tegn'),
})

// POST /api/leagues — opprett ny liga (krever Premium)
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`leagues-post:${ip}`, 5, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // Krev Premium
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status')
    .eq('id', user.id)
    .single()

  if (!profile?.premium_status) {
    return NextResponse.json({ error: 'Opprettelse av liga krever Premium.' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig JSON.' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((e) => e.message).join(', ') }, { status: 422 })
  }

  const { name } = parsed.data
  const slug = toSlug(name)

  const { data: league, error: insertError } = await supabaseAdmin
    .from('leagues')
    .insert({ name, slug, owner_id: user.id })
    .select('id, name, slug, owner_id, invite_token, reset_at, created_at')
    .single()

  if (insertError) {
    return NextResponse.json({ error: 'Kunne ikke opprette liga.' }, { status: 500 })
  }

  // Legg eieren til som medlem
  const { error: memberError } = await supabaseAdmin
    .from('league_members')
    .insert({ league_id: league.id, user_id: user.id })

  if (memberError) {
    // Rollback — slett ligaen igjen
    await supabaseAdmin.from('leagues').delete().eq('id', league.id)
    return NextResponse.json({ error: 'Kunne ikke opprette liga.' }, { status: 500 })
  }

  return NextResponse.json({ league: { ...league, is_owner: true, member_count: 1 } }, { status: 201 })
}
