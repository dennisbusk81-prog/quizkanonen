import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/reset-season — slett season_scores for denne ligaen (krever eierskap)
// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function POST(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `league-season-reset:${ip}`
  if (!rateLimit(rlKey, 5, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 5, windowMs: 60_000 })
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

  // Oppdater også legacy reset_at (all-time-systemet).
  // Feiler denne ETTER at season_scores er slettet, står de to systemene igjen
  // med hver sin sannhet: månedsfanen viser null, all-time viser gamle tall.
  // Halvveis nullstilt er verre enn ikke nullstilt, fordi ingenting sier fra.
  const { error: resetAtErr } = await supabaseAdmin
    .from('leagues')
    .update({ reset_at: new Date().toISOString() })
    .eq('id', id)

  if (resetAtErr) {
    console.error('[reset-season/league] reset_at-oppdatering feilet', id, resetAtErr.message)
    return NextResponse.json(
      { error: 'Sesong-poengene ble slettet, men all-time-listen ble ikke nullstilt. Prøv igjen.' },
      { status: 500 }
    )
  }

  // Logg handlingen
  try {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      user_id: user.id, action_type: 'season_reset_all', scope_type: 'league', scope_id: id,
    })
    if (logErr) console.error('[reset-season/league] admin_actions-logging feilet', id, logErr)
  } catch (err) {
    console.error('[reset-season/league] admin_actions-logging kastet', id, err)
  }

  return NextResponse.json({ ok: true })
}
