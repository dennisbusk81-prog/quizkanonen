import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { getOrBuildSnapshot, computePlacement } from '@/lib/ranking-snapshot'

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { searchParams } = new URL(request.url)
  const quizId         = searchParams.get('quiz_id')
  // `question` sendes fortsatt av klienten, men påvirker ikke lenger cache-nøkkelen
  // (snapshoten er uavhengig av spørsmålsindeks — se lib/ranking-snapshot.ts).
  const currentCorrect = parseInt(searchParams.get('current_correct')  ?? '0', 10)
  const currentTime    = parseInt(searchParams.get('current_time_ms')  ?? '0', 10)
  // Del 1+2 — besvarte spørsmål så langt + quizens lengde, så computePlacement
  // kan skalere delsummen opp til samme skala som de ferdige forsøkene den
  // sammenlignes mot. Valgfrie: mangler de, er oppførselen uendret.
  const answeredRaw = parseInt(searchParams.get('answered') ?? '', 10)
  const totalRaw    = parseInt(searchParams.get('total')    ?? '', 10)
  const answered       = Number.isFinite(answeredRaw) ? answeredRaw : null
  const totalQuestions = Number.isFinite(totalRaw)    ? totalRaw    : null

  if (!quizId) {
    return NextResponse.json({ error: 'quiz_id required' }, { status: 400 })
  }

  // Nøklet på IP+quiz, ikke bruker — se FALLGRUVE-avsnittet i CLAUDE.md.
  // Ruten kalles ÉN GANG PER SPØRSMÅL av Premium-spillere, så 30/60s tilsvarer
  // ca. 6 samtidige Premium-spillere bak samme IP. At det ikke biter i dag
  // skyldes utelukkende at telleren er in-memory (per instans).
  //
  // Loggingen finnes fordi symptomet ellers er HELT stille: et 429 gir
  // `fetchLiveRankingFull` → null i klienten, og mellomskjermen vises uten
  // plassering. Premium-funksjonen forsvinner da uten feilmelding, uten
  // Sentry-hendelse og — fram til nå — uten loggspor.
  const rlKey = `live-ranking:${ip}:${quizId}`
  const rl = rateLimit(rlKey, 30, 60_000)
  if (!rl.success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 30, windowMs: 60_000, quizId })
    return NextResponse.json(
      { error: 'For mange forespørsler — prøv igjen om litt' },
      { status: 429 }
    )
  }

  // Sak 1B — les den SAMME kortlevde snapshoten som ikke-premium-spennet, slik
  // at premium-eksakt og ikke-premium-spenn er internt konsistente per definisjon
  // (samme ferdig-pool, samme rang-definisjon, gjester inkludert).
  let snapshot
  try {
    snapshot = await getOrBuildSnapshot(quizId)
  } catch (err) {
    console.error('[live-ranking] snapshot feilet:', err)
    return NextResponse.json({ totalPlayers: 0, userRank: 1, low: 1, high: 1, above: null, below: null })
  }

  if (snapshot.length === 0) {
    return NextResponse.json(
      { totalPlayers: 0, userRank: 1, low: 1, high: 1, above: null, below: null }
    )
  }

  // playerInPool: false — under spill er den nåværende spilleren beviselig IKKE i
  // den ferdige poolen (uferdig forsøk), så total = ferdige + 1. Del A garanterer
  // dermed rang <= total («20 av 20», aldri «20 av 19»).
  const { rank, total, low, high, above, below } = computePlacement(snapshot, {
    correct: currentCorrect,
    time: isNaN(currentTime) ? 0 : currentTime,
    playerInPool: false,
    answered,
    totalQuestions,
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
    }
  )
}
