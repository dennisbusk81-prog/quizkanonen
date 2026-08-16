import { NextRequest, NextResponse } from 'next/server'
import { executeScheduledRemovals } from '@/lib/org-member-removal'

// GET /api/cron/scheduled-removals — kjøres daglig.
//
// Utfører fjerninger som org-admin har planlagt fram i tid. Selve fjerningen
// gjøres av den DELTE removeOrgMemberById() i lib/org-member-removal.ts — samme
// kodesti som «Fjern nå» i bedriftspanelet — så grace-periode (7 dager) og
// e-post er identisk med en manuell fjerning.
//
// Ruten er bevisst tynn, samme mønster som /api/cron/award-season-points:
// CRON_SECRET-vakt, kall til lib, JSON tilbake. All logikk som er verdt å teste
// bor i lib-funksjonen.
//
// SCHEDULERING: lagt inn i vercel.json (03:30 UTC daglig), IKKE hos cron-job.org
// som flere av de eldre cronene. Grunnen er at denne fjerner tilgang på en dato
// en admin har lovet en ansatt — en cron som aldri ble registrert manuelt ville
// betydd at ingen planlagt fjerning noensinne skjedde, uten et eneste feilspor.
// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const run = await executeScheduledRemovals()

    if (run.due === 0) {
      return NextResponse.json({ due: 0, removed: 0, reason: 'ingen forfalte fjerninger' })
    }

    return NextResponse.json(run)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ukjent feil'
    console.error('[cron/scheduled-removals] kjøringen feilet:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
