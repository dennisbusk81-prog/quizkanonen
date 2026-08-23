import { NextRequest, NextResponse } from 'next/server'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { liveRateLimitKey, LIVE_RANKING_RATE_LIMIT } from '@/lib/live-rate-limit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrBuildSnapshot, computePlacement } from '@/lib/ranking-snapshot'
import { filterSnapshotToPublic } from '@/lib/public-snapshot'
import { attemptIsPremium, gatePlacement } from '@/lib/live-premium'

// ── To gater, lagt på 23. august 2026 (P-2) ──────────────────────────────────
//
// 1. PREMIUM — og her er NAVNENE det viktigste. Ruten sendte `userRank` pluss
//    `above`/`below` MED NAVN til enhver kaller, uten noen auth-sjekk. Bekreftet
//    anonymt mot prod 23. august: et rått curl ga `userRank: 16` sammen med to
//    navngitte spillere. Et tall er en plassering; et navn er en
//    personopplysning om noen som aldri har bedt om å bli vist til en fremmed.
//    Alle tre faller nå sammen, i gatePlacement — de kan ikke skilles ad ved en
//    senere redigering.
//
//    `low`/`high` går fortsatt til alle: spennet ER gratisvisningen, og ruten
//    har levert det siden Del 5 nettopp for at ett kall skal dekke begge
//    tiere. En ikke-premium kaller får derfor et fullverdig, men grovere svar
//    — ikke en feil, og ikke en tom respons.
//
// 2. BLOKKERT-GATEN, som manglet helt. Snapshoten er UFILTRERT: en spiller som
//    er holdt utenfor den åpne konkurransen kunne både telles i `totalPlayers`
//    OG navngis som nabo.
//
//    MÅLT MOT PROD, 21. august-quizen: `totalPlayers` var 68 før gaten og er
//    66 etter. Differansen er 2 — de blokkerte. Begge tallene er «pool + 1»:
//    kalleren har ikke levert ennå (playerInPool: false) og telles derfor med
//    i sitt eget «av N». Poolen selv gikk fra 67 leverte til 65 synlige.
//    /standings sier 65 om samme quiz uten at det er et avvik — den kjører
//    playerInPool: true, siden spilleren der allerede er i feltet.
//
//    lib/public-snapshot.ts har stått og pekt på nettopp denne ruten siden
//    13. august — social-proof ble gjort, denne ble ikke.

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

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

  // Nøklet på ATTEMPT-TOKEN når det finnes, ellers anon:<ip> — re-nøklingen
  // ble gjort FØR delt teller (8daf475), i rekkefølgen CLAUDE.md krever.
  // Grensen (30/60s) er UENDRET — se lib/live-rate-limit.ts for hele
  // begrunnelsen, inkludert hvorfor verifiseringen er lokal HMAC og ikke et
  // GoTrue-kall.
  //
  // DELT teller (steg 4, 22. august 2026): rateLimitShared kjører selv
  // in-memory-laget først og kortslutter på lokalt avslag, faller ÅPENT ved
  // Upstash-feil (maks 1 s, deretter slipper kallet gjennom) og er inert uten
  // KV-env. Kostnad ~9 ms median i et 9000 ms-budsjett (NEXT_STEP_TIMEOUT_MS),
  // og kallet ligger parallelt med den tyngre spørsmålshentingen i klienten.
  //
  // Loggingen finnes fordi symptomet ellers er HELT stille: et 429 gir
  // `fetchLiveRankingFull` → null i klienten, og mellomskjermen vises uten
  // plassering. Premium-funksjonen forsvinner da uten feilmelding, uten
  // Sentry-hendelse og — fram til nå — uten loggspor.
  const attemptId = searchParams.get('attemptId')
  const attemptToken = request.headers.get('x-attempt-token')
  const rlKey = liveRateLimitKey('live-ranking', { ip, quizId, attemptId, token: attemptToken })
  const rl = await rateLimitShared(rlKey, LIVE_RANKING_RATE_LIMIT.limit, LIVE_RANKING_RATE_LIMIT.windowMs)
  if (!rl.success) {
    logRateLimitHit(rlKey, {
      lag: 'delt',
      limit: LIVE_RANKING_RATE_LIMIT.limit,
      windowMs: LIVE_RANKING_RATE_LIMIT.windowMs,
      quizId,
    })
    return NextResponse.json(
      { error: 'For mange forespørsler — prøv igjen om litt' },
      { status: 429 }
    )
  }

  // Kravet leses ut av det tokenet rate-limit-nøkkelen allerede verifiserte —
  // lokal HMAC, ingen rundtur. Se lib/live-premium.ts.
  const isPremium = attemptIsPremium({ quizId, attemptId, token: attemptToken })

  // Svarformen er den SAMME i alle utganger, også de tomme: klienten skal aldri
  // måtte gjette om `userRank` mangler fordi den er gatet eller fordi feltet er
  // tomt. `totalPlayers` beholder sitt eget navn (ikke `total`) — klienten leser
  // det, og en omdøping her ville vært en stille brekkasje.
  const empty = (premium: boolean) => {
    const g = gatePlacement({ rank: 1, total: 0, low: 1, high: 1, above: null, below: null }, premium)
    return NextResponse.json({
      totalPlayers: g.total, userRank: g.rank, low: g.low, high: g.high, above: g.above, below: g.below,
    })
  }

  // Sak 1B — les den SAMME kortlevde snapshoten som ikke-premium-spennet, slik
  // at premium-eksakt og ikke-premium-spenn er internt konsistente per definisjon
  // (samme ferdig-pool, samme rang-definisjon, gjester inkludert).
  //
  // Quiz-raden hentes PARALLELT — `season_points_awarded` trengs kun av
  // blokkert-gaten og skal ikke koste en seriell rundtur på mellomskjermens
  // latensbudsjett. Samme grep som /standings og ranking-snapshot.
  let snapshot
  let seasonPointsAwarded = false
  try {
    const [snap, quizRes] = await Promise.all([
      getOrBuildSnapshot(quizId),
      supabaseAdmin.from('quizzes').select('season_points_awarded').eq('id', quizId).maybeSingle(),
    ])
    snapshot = snap
    seasonPointsAwarded = quizRes.data?.season_points_awarded === true
  } catch (err) {
    console.error('[live-ranking] snapshot feilet:', err)
    return empty(isPremium)
  }

  if (snapshot.length === 0) return empty(isPremium)

  // Blokkert-gaten — samme delte helper som /standings, social-proof og
  // ranking-snapshot. Fail-stengt: klarer gaten ikke avgjøre hvem som er
  // blokkert, står bare gjestene igjen, og feltet blir tomt i inntil ett kall.
  const { publicSnapshot } = await filterSnapshotToPublic(quizId, snapshot, seasonPointsAwarded)
  if (publicSnapshot.length === 0) return empty(isPremium)

  // playerInPool: false — under spill er den nåværende spilleren beviselig IKKE i
  // den ferdige poolen (uferdig forsøk), så total = ferdige + 1. Del A garanterer
  // dermed rang <= total («20 av 20», aldri «20 av 19»).
  const placement = computePlacement(publicSnapshot, {
    correct: currentCorrect,
    time: isNaN(currentTime) ? 0 : currentTime,
    playerInPool: false,
    answered,
    totalQuestions,
  })
  const { rank, total, low, high, above, below } = gatePlacement(placement, isPremium)

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
