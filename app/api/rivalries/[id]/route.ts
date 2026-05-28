import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/rivalries/[id] — accept or decline (only rival_id can do this)
export async function PATCH(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`rivalries-patch:${ip}`, 10, 60_000)
  if (!rl.success) return NextResponse.json({ error: 'For mange forespørsler.' }, { status: 429 })

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id } = await params

  const body = await request.json()
  const action = body.action
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ error: 'Ugyldig handling. Bruk accept eller decline.' }, { status: 400 })
  }

  const { data: rivalry } = await supabaseAdmin
    .from('rivalries')
    .select('id, challenger_id, rival_id, status')
    .eq('id', id)
    .single()

  if (!rivalry) return NextResponse.json({ error: 'Duellen finnes ikke' }, { status: 404 })
  if (rivalry.status !== 'pending') return NextResponse.json({ error: 'Duellen er ikke lenger ventende' }, { status: 409 })
  if (rivalry.rival_id !== user.id) return NextResponse.json({ error: 'Bare den utfordrede kan svare' }, { status: 403 })

  const newStatus = action === 'accept' ? 'active' : 'declined'

  const { error: updateError } = await supabaseAdmin
    .from('rivalries')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (updateError) {
    console.error('[rivalries PATCH] update error:', updateError.message)
    return NextResponse.json({ error: 'Noe gikk galt.' }, { status: 500 })
  }

  return NextResponse.json({ success: true, status: newStatus })
}

// DELETE /api/rivalries/[id] — cancel duel
// pending: only challenger can cancel
// active: both challenger and rival can cancel
export async function DELETE(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`rivalries-delete:${ip}`, 10, 60_000)
  if (!rl.success) return NextResponse.json({ error: 'For mange forespørsler.' }, { status: 429 })

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id } = await params

  const { data: rivalry } = await supabaseAdmin
    .from('rivalries')
    .select('id, challenger_id, rival_id, status')
    .eq('id', id)
    .single()

  if (!rivalry) return NextResponse.json({ error: 'Duellen finnes ikke' }, { status: 404 })

  if (rivalry.status !== 'pending' && rivalry.status !== 'active') {
    return NextResponse.json({ error: 'Duellen kan ikke kanselleres' }, { status: 409 })
  }

  // Pending: only challenger can cancel
  if (rivalry.status === 'pending' && rivalry.challenger_id !== user.id) {
    return NextResponse.json({ error: 'Bare utfordreren kan trekke tilbake en ventende duell' }, { status: 403 })
  }

  // Active: both can cancel
  if (rivalry.status === 'active' && rivalry.challenger_id !== user.id && rivalry.rival_id !== user.id) {
    return NextResponse.json({ error: 'Du er ikke del av denne duellen' }, { status: 403 })
  }

  const { error: updateError } = await supabaseAdmin
    .from('rivalries')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (updateError) {
    console.error('[rivalries DELETE] update error:', updateError.message)
    return NextResponse.json({ error: 'Noe gikk galt.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
