import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUserPremium } from '@/lib/premium-check'
import { getPlayerHistory, getPlayerStats } from '@/lib/history'
import type { PlayerHistoryResult } from '@/lib/history'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest): Promise<NextResponse<PlayerHistoryResult | { error: string }>> {
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

  const [{ items: history, total }, stats] = await Promise.all([
    getPlayerHistory(user.id, { page, pageSize }),
    getPlayerStats(user.id),
  ])

  return NextResponse.json({ history, stats, total, page, pageSize })
}
