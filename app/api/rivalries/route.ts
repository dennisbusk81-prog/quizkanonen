import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { duelInviteEmail } from '@/lib/email-templates'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe'
import { blocksNewDuel } from '@/lib/duel-expiry'
import { hasExhaustedChallengesToRecipient, SAME_RECIPIENT_WINDOW_MS } from '@/lib/duel-cooldown'

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
  // Eksplisitt UUID-validering FØR verdien brukes noe sted. rivalId limes
  // senere rått inn i .or()-filterstrenger (PostgREST-syntaks), og frem til nå
  // hvilte sikkerheten på at profiloppslaget under tilfeldigvis feiler for
  // ikke-UUID-er og returnerer 400 først — altså på rekkefølgen av to
  // uavhengige kodelinjer. Nå er ugyldig input avvist uansett hva som måtte
  // flyttes rundt senere. (FUNN 5.5 fra duell-kartleggingen 28. juli 2026.)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rivalId)) {
    return NextResponse.json({ error: 'Ugyldig rival_id' }, { status: 400 })
  }
  if (rivalId === user.id) return NextResponse.json({ error: 'Du kan ikke utfordre deg selv' }, { status: 400 })

  // H2H Duell er gratis for alle innloggede — ingen Premium-krav.
  // Hent likevel motstanderens profil for navn (feilmelding/e-post) og
  // e-postpreferanse. Verifiser samtidig at brukeren finnes.
  const { data: rivalProfile } = await supabaseAdmin
    .from('profiles')
    .select('display_name, email_duel_notifications')
    .eq('id', rivalId)
    .single()

  if (!rivalProfile) {
    return NextResponse.json({ error: 'Fant ikke motstanderen' }, { status: 400 })
  }

  const nowForCheck = new Date()

  // Blokkeringssjekken bruker den DELTE utløpsregelen (lib/duel-expiry), samme
  // som /api/rivalries/my og opprydningsjobben. Tidligere hadde denne ruten sin
  // egen regel — «opprettet denne kalendermåneden» — uavhengig av 14-dagers
  // svarvinduet. En ubesvart utfordring sendt dag 1–17 forsvant da fra UI-et
  // etter 14 dager (og mistet «Trekk tilbake»-knappen) mens den fortsatt
  // blokkerte nye dueller for BEGGE parter ut måneden. Se FUNN 2.2.
  //
  // Filtreringen skjer i JS fordi regelen er ulik per status (14 dager for
  // pending, kalendermåned for active) og ikke lar seg uttrykke som ett
  // PostgREST-filter. Volumet er en håndfull rader per bruker.
  const openStatuses = ['pending', 'active']

  const { data: myRows } = await supabaseAdmin
    .from('rivalries')
    .select('id, status, created_at')
    .or(`challenger_id.eq.${user.id},rival_id.eq.${user.id}`)
    .in('status', openStatuses)

  if ((myRows ?? []).some(r => blocksNewDuel(r, nowForCheck))) {
    return NextResponse.json(
      { error: 'Du har allerede en aktiv eller ventende duell.' },
      { status: 409 }
    )
  }

  const { data: rivalRows } = await supabaseAdmin
    .from('rivalries')
    .select('id, status, created_at')
    .or(`challenger_id.eq.${rivalId},rival_id.eq.${rivalId}`)
    .in('status', openStatuses)

  if ((rivalRows ?? []).some(r => blocksNewDuel(r, nowForCheck))) {
    const name = rivalProfile.display_name ?? 'Motstanderen'
    return NextResponse.json(
      { error: `${name} har allerede en aktiv eller ventende duell.` },
      { status: 409 }
    )
  }

  // ── Spam-sperre mot ÉN mottaker (FUNN 3.3) ────────────────────────────────
  // Uavhengig av IP-rate-limiten over: teller faktiske utfordringer sendt til
  // denne mottakeren siste døgn, uansett status. En kansellert utfordring har
  // allerede kostet mottakeren en e-post og teller derfor med — det er nettopp
  // løkken utfordre → kanseller → utfordre denne sperren finnes for.
  const cooldownSince = new Date(nowForCheck.getTime() - SAME_RECIPIENT_WINDOW_MS).toISOString()
  const { data: recentToRival } = await supabaseAdmin
    .from('rivalries')
    .select('created_at')
    .eq('challenger_id', user.id)
    .eq('rival_id', rivalId)
    .gte('created_at', cooldownSince)

  if (hasExhaustedChallengesToRecipient((recentToRival ?? []).map(r => r.created_at), nowForCheck)) {
    const name = rivalProfile.display_name ?? 'denne spilleren'
    return NextResponse.json(
      { error: `Du har utfordret ${name} flere ganger det siste døgnet. Prøv igjen senere.` },
      { status: 429 }
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

  // Re-sjekk mot race condition: dukket det opp en annen rad for en av partene
  // mens vi satte inn vår, slettes vår igjen og vi svarer 409.
  // (En unique-constraint på DB-nivå er den endelige fiksen; dette er en
  // best-effort-vakt.)
  //
  // Må bruke SAMME utløpsregel som blokkeringssjekken over. Uten den ville en
  // gammel, utløpt pending-rad — som blokkeringssjekken nettopp slapp forbi —
  // slått til her i stedet, slettet den ferske raden og gjeninnført dødlåsen
  // fra FUNN 2.2 i en verre form (utfordringen ville sett ut til å bli sendt,
  // for så å forsvinne).
  const { data: conflictRows } = await supabaseAdmin
    .from('rivalries')
    .select('id, status, created_at')
    .or(
      `and(challenger_id.eq.${user.id},status.in.(pending,active)),` +
      `and(rival_id.eq.${user.id},status.in.(pending,active)),` +
      `and(challenger_id.eq.${rivalId},status.in.(pending,active)),` +
      `and(rival_id.eq.${rivalId},status.in.(pending,active))`
    )
    .neq('id', rivalry.id)

  const conflict = (conflictRows ?? []).filter(r => blocksNewDuel(r, nowForCheck))

  if (conflict.length > 0) {
    await supabaseAdmin.from('rivalries').delete().eq('id', rivalry.id)
    return NextResponse.json(
      { error: 'En av dere fikk akkurat en ny duell. Last siden på nytt og prøv igjen.' },
      { status: 409 }
    )
  }

  // Send e-post til motstanderen — non-blocking, feil stopper ikke responsen
  try {
    const { data: { user: rivalUser } } = await supabaseAdmin.auth.admin.getUserById(rivalId)
    const challengerName = (await supabaseAdmin.from('profiles').select('display_name').eq('id', user.id).single()).data?.display_name ?? user.email ?? 'En spiller'
    if (rivalUser?.email && rivalProfile?.email_duel_notifications !== false) {
      const unsubUrl = buildUnsubscribeUrl(rivalId, 'duel')
      await sendEmail({
        to: rivalUser.email,
        subject: `${challengerName} utfordrer deg til en duell!`,
        html: duelInviteEmail(challengerName, unsubUrl),
      })
    }
  } catch {
    // E-postfeil skal ikke blokkere duell-opprettelsen
  }

  return NextResponse.json({ success: true, id: rivalry.id }, { status: 201 })
}
