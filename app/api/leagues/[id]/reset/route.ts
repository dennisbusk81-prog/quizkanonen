import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/reset — sett reset_at = now() (krever eierskap)
export async function POST(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`league-reset:${ip}`, 10, 60_000).success) {
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
    return NextResponse.json({ error: 'Bare eieren kan nullstille ligaen.' }, { status: 403 })
  }

  const resetAt = new Date().toISOString()

  const { error: updateError } = await supabaseAdmin
    .from('leagues')
    .update({ reset_at: resetAt })
    .eq('id', id)

  if (updateError) return NextResponse.json({ error: 'Kunne ikke nullstille ligaen.' }, { status: 500 })

  return NextResponse.json({ ok: true, reset_at: resetAt })
}
