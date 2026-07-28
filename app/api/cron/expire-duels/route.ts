import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDuelExpired, PENDING_REPLY_WINDOW_MS } from '@/lib/duel-expiry'

// GET /api/cron/expire-duels — kjøres daglig.
// Markerer ubesvarte duell-utfordringer som har passert 14-dagersvinduet med
// status 'expired'. Beskyttet med CRON_SECRET (samme mønster som de andre
// cron-rutene). Schedulering legges til manuelt av Dennis.
//
// Bakgrunn (kartlegging 28. juli 2026, FUNN 2.1): ingen jobb rørte rivalries,
// så ubesvarte rader ble stående 'pending' for alltid. Utløp var kun en
// UI-beregning, og de gamle radene hopet seg opp i databasen.
//
// VIKTIG — denne jobben er en OPPRYDNING, ikke en forutsetning:
// dødlåsfiksen (FUNN 2.2) ligger i lib/duel-expiry og virker på tidsregelen
// alene. Kjører aldri denne jobben, oppfører appen seg nøyaktig som med den —
// radene blir bare stående umerket i databasen. Det er med vilje: statusen er
// en materialisering av noe koden uansett regner ut, aldri en kilde til
// sannhet den ikke allerede har.
//
// Krever at CHECK-constrainten på rivalries.status tillater 'expired'
// (se docs/sql/2026-07-28-duell.sql). Gjør den ikke det, feiler
// oppdateringen synlig her i stedet for å gå stille galt.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const cutoff = new Date(now.getTime() - PENDING_REPLY_WINDOW_MS).toISOString()

  const { data: candidates, error } = await supabaseAdmin
    .from('rivalries')
    .select('id, status, created_at')
    .eq('status', 'pending')
    .lt('created_at', cutoff)

  if (error) {
    console.error('[cron/expire-duels] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Dobbeltsjekk mot den delte regelen i stedet for å stole på at
  // cutoff-filteret alene er riktig — én kilde til sannhet for hva «utløpt» er.
  const toExpire = (candidates ?? []).filter(r => isDuelExpired(r.status, r.created_at, now))

  if (toExpire.length === 0) {
    return NextResponse.json({ expired: 0, reason: 'no expired pending duels' })
  }

  const { error: updateError } = await supabaseAdmin
    .from('rivalries')
    .update({ status: 'expired', updated_at: now.toISOString() })
    .in('id', toExpire.map(r => r.id))

  if (updateError) {
    console.error('[cron/expire-duels] update error:', updateError.message)
    return NextResponse.json({ error: updateError.message, attempted: toExpire.length }, { status: 500 })
  }

  console.log(`[cron/expire-duels] markerte ${toExpire.length} ubesvarte duell(er) som utløpt`)
  return NextResponse.json({ expired: toExpire.length })
}
