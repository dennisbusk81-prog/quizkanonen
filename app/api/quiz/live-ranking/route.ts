import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { getOrBuildSnapshot, computePlacement } from '@/lib/ranking-snapshot'

// FIX 12 — removed `export const revalidate = 30`; caching is set via response headers instead

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { searchParams } = new URL(request.url)
  const quizId         = searchParams.get('quiz_id')
  // `question` sendes fortsatt av klienten, men påvirker ikke lenger cache-nøkkelen
  // (snapshoten er uavhengig av spørsmålsindeks — se lib/ranking-snapshot.ts).
  const currentCorrect = parseInt(searchParams.get('current_correct')  ?? '0', 10)
  const currentTime    = parseInt(searchParams.get('current_time_ms')  ?? '0', 10)

  if (!quizId) {
    return NextResponse.json({ error: 'quiz_id required' }, { status: 400 })
  }

  const rl = rateLimit(`live-ranking:${ip}:${quizId}`, 30, 60_000)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'For mange forespørsler — prøv igjen om litt' },
      { status: 429 }
    )
  }

  // FIX 12 — max-age=0 so browsers revalidate every time; s-maxage=10 lets CDN/edge cache briefly
  const HEADERS = { 'Cache-Control': 'public, s-maxage=10, max-age=0' }

  // Sak 1B — les den SAMME kortlevde snapshoten som ikke-premium-spennet, slik
  // at premium-eksakt og ikke-premium-spenn er internt konsistente per definisjon
  // (samme ferdig-pool, samme rang-definisjon, gjester inkludert).
  let snapshot
  try {
    snapshot = await getOrBuildSnapshot(quizId)
  } catch (err) {
    console.error('[live-ranking] snapshot feilet:', err)
    return NextResponse.json({ totalPlayers: 0, userRank: 1, low: 1, high: 1, above: null, below: null }, { headers: HEADERS })
  }

  if (snapshot.length === 0) {
    return NextResponse.json(
      { totalPlayers: 0, userRank: 1, low: 1, high: 1, above: null, below: null },
      { headers: HEADERS }
    )
  }

  // playerInPool: false — under spill er den nåværende spilleren beviselig IKKE i
  // den ferdige poolen (uferdig forsøk), så total = ferdige + 1. Del A garanterer
  // dermed rang <= total («20 av 20», aldri «20 av 19»).
  const { rank, total, low, high, above, below } = computePlacement(snapshot, {
    correct: currentCorrect,
    time: isNaN(currentTime) ? 0 : currentTime,
    playerInPool: false,
  })

  // low/high er additivt (Del 5): computePlacement beregnet dem allerede, ruten
  // kastet dem bare. Med dem i responsen dekker ETT kall både premium-blokken i
  // mellomskjermen og spenn-visningen, i stedet for at klienten gjør to separate
  // kall mot samme snapshot per spørsmål. Identiske verdier som
  // /api/quiz/[id]/ranking-snapshot — samme snapshot, samme computePlacement,
  // samme playerInPool:false.
  return NextResponse.json(
    {
      totalPlayers: total,
      userRank: rank,
      low,
      high,
      above,
      below,
    },
    { headers: HEADERS }
  )
}
