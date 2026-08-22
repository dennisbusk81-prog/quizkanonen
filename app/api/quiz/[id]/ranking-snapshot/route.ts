import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { liveRateLimitKey, RANKING_SNAPSHOT_RATE_LIMIT } from '@/lib/live-rate-limit'
import { getOrBuildSnapshot, computePlacement } from '@/lib/ranking-snapshot'

type RankResult = { rank: number; total: number; low: number; high: number }

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<RankResult | { error: string }>> {
  const { id: quizId } = await params
  const { searchParams } = new URL(request.url)

  const questionIndex = parseInt(searchParams.get('question') ?? '0', 10)
  const correct       = parseInt(searchParams.get('correct')  ?? '0', 10)
  const time          = parseInt(searchParams.get('time')     ?? '0', 10)

  if (!quizId || isNaN(questionIndex) || isNaN(correct) || isNaN(time)) {
    return NextResponse.json({ error: 'Ugyldig input' }, { status: 400 })
  }

  // Del 1+2 — besvarte spørsmål så langt + quizens lengde, så computePlacement
  // kan skalere delsummen opp til samme skala som de ferdige forsøkene den
  // sammenlignes mot. Bevisst VALGFRIE: mangler de (gammel fane midt i en quiz
  // under deploy), faller ruten tilbake til uendret oppførsel i stedet for 400.
  const answeredRaw = parseInt(searchParams.get('answered') ?? '', 10)
  const totalRaw    = parseInt(searchParams.get('total')    ?? '', 10)
  const answered       = Number.isFinite(answeredRaw) ? answeredRaw : null
  const totalQuestions = Number.isFinite(totalRaw)    ? totalRaw    : null

  // Rutens FØRSTE rate-limit (steg 3, 22. august 2026) — den var den mest
  // kalte av live-rutene (målt 1 447 kall 21. aug) og hadde ingen grense i
  // det hele tatt. Nøklet på attempt-token, ellers anon:<ip> — token-løse
  // kall (gammel fane under deploy) og gjester skal begge fungere, se
  // lib/live-rate-limit.ts for dimensjoneringen (60/60s er forankret i
  // målt toppminutt, ikke gjettet).
  //
  // Loggingen er ikke pynt: klienten svelger 429 uten feilmelding (rank-pillen
  // og mellomskjerm-spennet forsvinner bare), så en for lav grense er usynlig
  // uten TAK TRUFFET-linjen i Vercel-loggen.
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const attemptId = searchParams.get('attemptId')
  const attemptToken = request.headers.get('x-attempt-token')
  const rlKey = liveRateLimitKey('ranking-snapshot', { ip, quizId, attemptId, token: attemptToken })
  const rl = rateLimit(rlKey, RANKING_SNAPSHOT_RATE_LIMIT.limit, RANKING_SNAPSHOT_RATE_LIMIT.windowMs)
  if (!rl.success) {
    logRateLimitHit(rlKey, {
      lag: 'lokal',
      limit: RANKING_SNAPSHOT_RATE_LIMIT.limit,
      windowMs: RANKING_SNAPSHOT_RATE_LIMIT.windowMs,
      quizId,
    })
    return NextResponse.json(
      { error: 'For mange forespørsler — prøv igjen om litt' },
      { status: 429 }
    )
  }

  try {
    // Delt, kortlevd snapshot (samme som premium live-ranking leser).
    const snapshot = await getOrBuildSnapshot(quizId)

    // FIX 8 — ingen fullførte ennå: total: 0, ikke 1 (unngår «nr. 1 av 1» når
    // ingen har spilt).
    if (snapshot.length < 1) {
      return NextResponse.json({ rank: 1, total: 0, low: 1, high: 1 })
    }

    // Under spill: spilleren har ikke levert ennå og er ikke i den ferdige
    // poolen → playerInPool: false (total = ferdige + 1). Resultatskjermen bruker
    // /standings, ikke denne ruten. computePlacement garanterer rang <= total.
    const { rank, total, low, high } = computePlacement(snapshot, {
      correct, time, playerInPool: false, answered, totalQuestions,
    })

    return NextResponse.json({ rank, total, low, high })
  } catch (err) {
    console.error('[ranking-snapshot] feil:', err)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
  }
}
