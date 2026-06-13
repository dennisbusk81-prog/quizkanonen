import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { duelInviteEmail } from '@/lib/email-templates'

// POST /api/rivalries — send a duel challenge to another user
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`rivalries-create:${ip}`, 5, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler. Vent litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const body = await request.json()
  const rivalId = typeof body.rival_id === 'string' ? body.rival_id.trim() : ''
  if (!rivalId) return NextResponse.json({ error: 'Mangler rival_id' }, { status: 400 })
  if (rivalId === user.id) return NextResponse.json({ error: 'Du kan ikke utfordre deg selv' }, { status: 400 })

  // Challenger must be Premium
  const { data: challengerProfile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status')
    .eq('id', user.id)
    .single()

  if (challengerProfile?.premium_status !== true) {
    return NextResponse.json({ error: 'Du trenger Premium for å utfordre en rival' }, { status: 403 })
  }

  // Target must be Premium — also fetch display_name for error message (Fix 2)
  const { data: rivalProfile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, display_name')
    .eq('id', rivalId)
    .single()

  if (!rivalProfile || rivalProfile.premium_status !== true) {
    return NextResponse.json({ error: 'Motstanderen trenger også Premium for å delta i duell' }, { status: 400 })
  }

  // Fix 1 — only duels created this calendar month count as "active engagements".
  // An expired duel from last month (still status=active in DB) must not block new challenges.
  const nowForCheck = new Date()
  const thisMonthStart = new Date(Date.UTC(nowForCheck.getUTCFullYear(), nowForCheck.getUTCMonth(), 1)).toISOString()

  // Fix 2 — check each party separately so we can give a precise error message
  const { data: myExisting } = await supabaseAdmin
    .from('rivalries')
    .select('id')
    .or(`challenger_id.eq.${user.id},rival_id.eq.${user.id}`)
    .in('status', ['pending', 'active'])
    .gte('created_at', thisMonthStart)
    .limit(1)

  if (myExisting && myExisting.length > 0) {
    return NextResponse.json(
      { error: 'Du har allerede en aktiv eller ventende duell.' },
      { status: 409 }
    )
  }

  const { data: rivalExisting } = await supabaseAdmin
    .from('rivalries')
    .select('id')
    .or(`challenger_id.eq.${rivalId},rival_id.eq.${rivalId}`)
    .in('status', ['pending', 'active'])
    .gte('created_at', thisMonthStart)
    .limit(1)

  if (rivalExisting && rivalExisting.length > 0) {
    const name = rivalProfile.display_name ?? 'Motstanderen'
    return NextResponse.json(
      { error: `${name} har allerede en aktiv eller ventende duell.` },
      { status: 409 }
    )
  }

  const { data: rivalry, error: insertError } = await supabaseAdmin
    .from('rivalries')
    .insert({ challenger_id: user.id, rival_id: rivalId, status: 'pending' })
    .select('id')
    .single()

  if (insertError) {
    console.error('[rivalries POST] insert error:', insertError.message)
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // Fix 1 — re-check for race condition: if another row now exists for either party,
  // delete our newly inserted row and return a conflict.
  // (A DB-level unique constraint is the definitive fix; this is a best-effort guard.)
  const { data: conflict } = await supabaseAdmin
    .from('rivalries')
    .select('id')
    .or(
      `and(challenger_id.eq.${user.id},status.in.(pending,active)),` +
      `and(rival_id.eq.${user.id},status.in.(pending,active)),` +
      `and(challenger_id.eq.${rivalId},status.in.(pending,active)),` +
      `and(rival_id.eq.${rivalId},status.in.(pending,active))`
    )
    .neq('id', rivalry.id)
    .limit(1)

  if (conflict && conflict.length > 0) {
    await supabaseAdmin.from('rivalries').delete().eq('id', rivalry.id)
    return NextResponse.json(
      { error: 'En av dere fikk akkurat en ny duell. Last siden på nytt og prøv igjen.' },
      { status: 409 }
    )
  }

  // Send e-post til motstanderen — non-blocking, feil stopper ikke responsen
  try {
    const { data: { user: rivalUser } } = await supabaseAdmin.auth.admin.getUserById(rivalId)
    const challengerName = challengerProfile
      ? (await supabaseAdmin.from('profiles').select('display_name').eq('id', user.id).single()).data?.display_name ?? user.email ?? 'En spiller'
      : user.email ?? 'En spiller'
    if (rivalUser?.email) {
      await sendEmail({
        to: rivalUser.email,
        subject: `${challengerName} utfordrer deg til en duell!`,
        html: duelInviteEmail(challengerName),
      })
    }
  } catch {
    // E-postfeil skal ikke blokkere duell-opprettelsen
  }

  return NextResponse.json({ success: true, id: rivalry.id }, { status: 201 })
}
