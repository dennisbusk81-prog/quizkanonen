import { NextRequest, NextResponse } from 'next/server'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { liveRateLimitKey, RANKING_SNAPSHOT_RATE_LIMIT } from '@/lib/live-rate-limit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrBuildSnapshot, computePlacement } from '@/lib/ranking-snapshot'
import { filterSnapshotToPublic } from '@/lib/public-snapshot'
import { attemptIsPremium, gatePlacement, type GatedPlacement } from '@/lib/live-premium'

// ── To gater, lagt på 23. august 2026 (P-2) ──────────────────────────────────
//
// 1. PREMIUM. Ruten sendte `rank` — det eksakte tallet — til enhver kaller.
//    Klienten gatet visningen, serveren gatet ingenting: et anonymt curl mot
//    prod ga `{"rank":16,"total":68,...}`. Nå kommer `rank` kun til en kaller
//    som kan bevise Premium med et signert attempt-token, og `null` ellers.
//    `low`/`high` går som før til alle — spennet ER gratisvisningen.
//
//    Rank-pillen under spilling (`#42` ved siden av poengsummen) leste `rank`
//    for ALLE innloggede, uten premium-sjekk, på hver eneste fredagsquiz
//    (`show_live_placement` er true på samtlige ti siste quizer i prod). Av 67
//    spillere 21. august var 21 Premium — 46 så altså et eksakt tall de ikke
//    har betalt for. Pillen viser nå spennet (`#31–35`) for dem i stedet, samme
//    tall mellomskjermen alt ga dem ett skjermbilde senere. Se
//    lib/live-premium.ts for paritetskontrakten med klienten.
//
// 2. BLOKKERT-GATEN, som manglet helt. Snapshoten er UFILTRERT, så brukere som
//    er holdt utenfor den åpne konkurransen (org med allow_global_league=false,
//    eller eget opt-out) ble talt med i `total`.
//
//    MÅLT MOT PROD, 21. august-quizen — og les regnestykket nøye, for de tre
//    tallene har hver sin betydning:
//      • 67 = leverte solo-forsøk, altså den ferdige poolen.
//      • 65 = globale season_scores-rader, altså de SYNLIGE. Differansen på 2
//        er de blokkerte.
//      • `total` herfra var 68 FØR gaten og er 66 ETTER. Begge er «pool + 1»:
//        under spilling har kalleren ikke levert ennå (playerInPool: false),
//        så de legges til for at «du er nr. 16 av 66» skal telle deg selv.
//
//    Gaten flyttet altså tallet med nøyaktig 2 — de blokkerte — ikke med 3.
//    +1-en er kalleren og skal bli stående. At /standings sier 65 om samme
//    quiz er ikke et avvik: den ruten kjører playerInPool: true, fordi
//    spilleren der ER i feltet (resultatskjermen, etter innsending).
//
//    Samme delte helper som /standings og social-proof brukes nå.
//
//    Filteret er fail-STENGT (se lib/public-snapshot.ts): klarer gaten ikke
//    avgjøre hvem som er blokkert, blokkeres alle. Her betyr det et lite eller
//    tomt felt å rangere mot i inntil ett kall — en degradert plassering, ikke
//    en publisert.

type RankResult = GatedPlacement

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
  // DELT teller (steg 4, 22. august 2026): rateLimitShared kjører selv
  // in-memory-laget først og kortslutter på lokalt avslag, faller ÅPENT ved
  // Upstash-feil (maks 1 s, deretter slipper kallet gjennom) og er inert uten
  // KV-env. Kostnad ~9 ms median i et 9000 ms-budsjett (NEXT_STEP_TIMEOUT_MS),
  // og kallet ligger parallelt med den tyngre spørsmålshentingen i klienten.
  //
  // Loggingen er ikke pynt: klienten svelger 429 uten feilmelding (rank-pillen
  // og mellomskjerm-spennet forsvinner bare), så en for lav grense er usynlig
  // uten TAK TRUFFET-linjen i Vercel-loggen.
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const attemptId = searchParams.get('attemptId')
  const attemptToken = request.headers.get('x-attempt-token')
  const rlKey = liveRateLimitKey('ranking-snapshot', { ip, quizId, attemptId, token: attemptToken })
  const rl = await rateLimitShared(rlKey, RANKING_SNAPSHOT_RATE_LIMIT.limit, RANKING_SNAPSHOT_RATE_LIMIT.windowMs)
  if (!rl.success) {
    logRateLimitHit(rlKey, {
      lag: 'delt',
      limit: RANKING_SNAPSHOT_RATE_LIMIT.limit,
      windowMs: RANKING_SNAPSHOT_RATE_LIMIT.windowMs,
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

  try {
    // Snapshot og quiz-rad hentes PARALLELT. `season_points_awarded` trengs kun
    // av blokkert-gaten (den avgjør om settet leses historisk fra season_scores
    // eller live fra org-medlemskapene), og skal ikke koste en seriell rundtur
    // på rutens hete sti — samme grep som /standings gjør.
    const [snapshot, quizRes] = await Promise.all([
      getOrBuildSnapshot(quizId),
      supabaseAdmin.from('quizzes').select('season_points_awarded').eq('id', quizId).maybeSingle(),
    ])

    // FIX 8 — ingen fullførte ennå: total: 0, ikke 1 (unngår «nr. 1 av 1» når
    // ingen har spilt). Går gjennom gatePlacement som alt annet, slik at
    // svarformen er den SAMME i alle utganger — en klient skal aldri måtte
    // gjette om `rank` mangler fordi den er gatet eller fordi den er tom.
    if (snapshot.length < 1) {
      return NextResponse.json(gatePlacement(
        { rank: 1, total: 0, low: 1, high: 1, above: null, below: null },
        isPremium,
      ))
    }

    // Blokkert-gaten — samme delte helper som /standings og social-proof.
    const { publicSnapshot } = await filterSnapshotToPublic(
      quizId,
      snapshot,
      quizRes.data?.season_points_awarded === true,
    )

    if (publicSnapshot.length < 1) {
      return NextResponse.json(gatePlacement(
        { rank: 1, total: 0, low: 1, high: 1, above: null, below: null },
        isPremium,
      ))
    }

    // Under spill: spilleren har ikke levert ennå og er ikke i den ferdige
    // poolen → playerInPool: false (total = ferdige + 1). Resultatskjermen bruker
    // /standings, ikke denne ruten. computePlacement garanterer rang <= total.
    const placement = computePlacement(publicSnapshot, {
      correct, time, playerInPool: false, answered, totalQuestions,
    })

    return NextResponse.json(gatePlacement(placement, isPremium))
  } catch (err) {
    console.error('[ranking-snapshot] feil:', err)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
  }
}
