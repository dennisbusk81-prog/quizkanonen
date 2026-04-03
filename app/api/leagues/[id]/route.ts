import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

// GET /api/leagues/[id] — hent ligainfo + medlemsliste (krever medlemskap)
export async function GET(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`league-get:${ip}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id } = await params

  // Sjekk at brukeren er medlem
  const { data: membership } = await supabaseAdmin
    .from('league_members')
    .select('user_id')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Du er ikke medlem av denne ligaen.' }, { status: 403 })
  }

  const [{ data: league, error: leagueError }, { data: members, error: membersError }] =
    await Promise.all([
      supabaseAdmin
        .from('leagues')
        .select('id, name, slug, owner_id, invite_token, reset_at, created_at')
        .eq('id', id)
        .single(),
      supabaseAdmin
        .from('league_members')
        .select('user_id, joined_at')
        .eq('league_id', id),
    ])

  if (leagueError || !league) {
    return NextResponse.json({ error: 'Fant ikke ligaen.' }, { status: 404 })
  }
  if (membersError) {
    return NextResponse.json({ error: 'Kunne ikke hente medlemmer.' }, { status: 500 })
  }

  const memberIds = (members ?? []).map((m) => m.user_id)

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name')
    .in('id', memberIds)

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))

  const memberList = (members ?? []).map((m) => ({
    user_id: m.user_id,
    display_name: profileMap.get(m.user_id) ?? 'Ukjent',
    joined_at: m.joined_at,
    is_owner: m.user_id === league.owner_id,
  }))

  return NextResponse.json({
    league: {
      ...league,
      is_owner: league.owner_id === user.id,
      member_count: memberList.length,
    },
    members: memberList,
  })
}

// DELETE /api/leagues/[id] — slett liga (krever eierskap)
export async function DELETE(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`league-delete:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id } = await params

  const { data: league } = await supabaseAdmin
    .from('leagues')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()

  if (!league) return NextResponse.json({ error: 'Fant ikke ligaen.' }, { status: 404 })
  if (league.owner_id !== user.id) {
    return NextResponse.json({ error: 'Bare eieren kan slette ligaen.' }, { status: 403 })
  }

  const { error: deleteError } = await supabaseAdmin.from('leagues').delete().eq('id', id)
  if (deleteError) return NextResponse.json({ error: 'Kunne ikke slette ligaen.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
