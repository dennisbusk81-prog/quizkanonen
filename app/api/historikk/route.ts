import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUserPremium } from '@/lib/premium-check'
import { getPlayerHistory, getPlayerStats } from '@/lib/history'
import type { ArchiveHistoryResult, PlayerHistoryResult } from '@/lib/history'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

const HISTORIKK_LESEFEIL = 'Kunne ikke hente historikken akkurat nå. Prøv igjen om litt.'

export async function GET(
  request: NextRequest
): Promise<NextResponse<PlayerHistoryResult | ArchiveHistoryResult | { error: string }>> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  // Samme delte Premium-sjekk som resten av gatingen (lib/premium-check.ts),
  // inkludert karensperiodene. Var tidligere en lokal `premium_status`-spørring
  // som hverken tok karens med eller leste `error` — en transient DB-feil ble
  // dermed til 403 «Krever premium» for en betalende kunde. «Vet ikke» skal
  // være et forbigående 503, aldri en dom.
  const premium = await getUserPremium(user.id)
  if (!premium.ok) {
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte tilgangen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }
  if (!premium.value) {
    return NextResponse.json({ error: 'Krever premium' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page     = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0)
  const pageSize = 50
  // Alt annet enn eksakt 'archive' faller til 'real' — scope kommer fra
  // URL-en og skal aldri kunne velge en tredje, utilsiktet populasjon.
  const scope    = searchParams.get('scope') === 'archive' ? 'archive' as const : 'real' as const

  // «Ingen historikk» skal aldri være svaret på «vi klarte ikke lese» (punkt
  // 4, 9. september 2026). getPlayerHistory returnerer Loaded, så lesefeilen
  // kan ikke lenger passere som en tom liste — og et 200 med tom liste er
  // verre her enn de fleste steder, fordi klienten lagrer svaret i
  // sessionStorage i fem minutter: brukeren får «du har ikke spilt noen
  // quizer», og en omlasting av siden hjelper ikke. Samme form som
  // premium-503-en over, og som checkout og de fire .single()-stedene fikk
  // samme dag.
  //
  // app/historikk/page.tsx tar allerede imot dette: `if (!res.ok)` gir
  // feilskjermen med «Prøv igjen», og returnerer FØR sessionStorage skrives.
  // Ingen ny feilflate er bygget her.

  // Arkiv-scopet får IKKE stats — se ArchiveHistoryResult i lib/history.ts.
  if (scope === 'archive') {
    const arkiv = await getPlayerHistory(user.id, { page, pageSize, scope })
    if (!arkiv.ok) {
      return NextResponse.json({ error: HISTORIKK_LESEFEIL }, { status: 503 })
    }
    return NextResponse.json({ history: arkiv.value.items, total: arkiv.value.total, page, pageSize })
  }

  const [historikk, stats] = await Promise.all([
    getPlayerHistory(user.id, { page, pageSize, scope }),
    getPlayerStats(user.id),
  ])

  if (!historikk.ok) {
    return NextResponse.json({ error: HISTORIKK_LESEFEIL }, { status: 503 })
  }

  return NextResponse.json({
    history: historikk.value.items,
    stats,
    total: historikk.value.total,
    page,
    pageSize,
  })
}
