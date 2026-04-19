import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/reset-season — slett season_scores for denne ligaen (krever eierskap)
export async function POST(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`league-season-reset:${ip}`, 5, 60_000).success) {
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
    return NextResponse.json({ error: 'Bare eieren kan nullstille sesong-data.' }, { status: 403 })
  }

  // Slett season_scores for denne ligaen
  const { error: delErr } = await supabaseAdmin
    .from('season_scores')
    .delete()
    .eq('scope_type', 'league')
    .eq('scope_id', id)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // Oppdater også legacy reset_at (all-time-systemet)
  await supabaseAdmin
    .from('leagues')
    .update({ reset_at: new Date().toISOString() })
    .eq('id', id)

  // Logg handlingen
  try {
    await supabaseAdmin.from('admin_actions').insert({
      user_id: user.id, action_type: 'season_reset_all', scope_type: 'league', scope_id: id,
    })
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true })
}
