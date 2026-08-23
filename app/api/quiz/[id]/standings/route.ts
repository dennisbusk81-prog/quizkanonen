import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrBuildSnapshot, computePlacement, type SnapshotEntry } from '@/lib/ranking-snapshot'
import { decideStandingsCache } from '@/lib/standings-cache'
import { filterSnapshotToPublic } from '@/lib/public-snapshot'
import { attemptIsPremium, gatePlacement } from '@/lib/live-premium'

// ── Ett felles endepunkt for resultatskjermen ────────────────────────────────
// Returnerer BÅDE topp-3 OG spillerens egen plassering, utledet fra ÉN felles
// rangert liste (getOrBuildSnapshot) i SAMME request. Dermed er det strukturelt
// umulig at "Topp 3 denne uken" og "Din plassering" viser ulike tall samtidig —
// de kommer fra samme øyeblikksbilde og samme rangeringsfunksjon.
//
// PREMIUM-GATE (P-2, 23. august 2026). Setningen som sto her — «Klienten avgjør
// visning» — var nøyaktig problemet: serveren sendte `rank` OG `above`/`below`
// med navn til enhver kaller, og klienten valgte å skjule det. Bekreftet anonymt
// mot prod 23. august: et curl uten auth ga `rank: 33` pluss navnet på spilleren
// over og under. Nå formes svaret av gatePlacement (lib/live-premium.ts), og
// identiteten kommer fra det signerte attempt-tokenet i `x-attempt-token` — ikke
// fra et auth-oppslag, av samme latensgrunn som live-rutene (se
// lib/attempt-token.ts).
//
// TO TING SOM MÅ HENGE SAMMEN HER, og som ikke gjør det andre steder:
//
//   a) `placement` beregnes nå KUN for et personlig kall. Fram til nå ble den
//      regnet også uten attemptId/correct/time — en plassering for en spiller
//      med 0 riktige på 0 ms, altså et tall uten mening — og den lå i det DELTE,
//      CDN-cachede svaret. Ingen klient har noen gang lest den derfra (begge
//      ikke-personlige kallstedene leser kun `top3`).
//
//   b) Og nettopp derfor: cache-headeren varierer ikke med tokenet. Et `public`
//      svar med premium-innhold ville blitt servert videre av CDN-en til neste
//      gratis kaller. Det kan ikke skje nå, fordi `public` og `placement` er
//      gjensidig utelukkende — et personlig kall er alltid `private`
//      (decideStandingsCache). Ikke gjeninnfør placement på den delte grenen
//      uten å ta cache-nøkkelen med i vurderingen; det er en lekkasje som
//      overlever i CDN-en i inntil 120 sekunder etter at koden er rettet.
//
// GLOBAL SYNLIGHETS-GATE (5. august 2026): brukere blokkert fra den åpne
// konkurransen (org med allow_global_league=false, eller eget opt-out —
// lib/globally-blocked-set.ts, samme delte sett som /api/leaderboard/[id] og
// prev-rank) filtreres ut av snapshoten FØR topp-3 og plassering regnes.
// Fram til nå regnet denne ruten mot det ufiltrerte feltet, så resultatskjermen
// sa «av 63 deltakere» mens leaderboard-siden sa «av 59» for samme quiz — og
// «Topp 3 denne uken» kunne vise en spiller som ikke fantes i listen ved siden
// av. Gjenværende re-rankes posisjonelt (snapshoten er allerede totalordnet),
// slik at rank og total alltid følger det SYNLIGE feltet.
//
// Egen plassering for en BLOKKERT kaller regnes bevisst mot det UFILTRERTE
// feltet — samme prinsipp som leaderboard-rutens mine-fallback («egne tall
// skjules aldri for en selv»): raden finnes, og placement-visibility-laget i
// klienten avgjør hva som faktisk vises (internal-only viser internt tall i
// stedet for dette).
//
// Merk: de fire søsterflatene (live-ranking, ranking-snapshot, rival,
// social-proof) sto BEVISST ugatet her fram til 23. august 2026 — «de reiser
// egne designspørsmål og tas separat». Alle fire er nå gatet: social-proof fikk
// blokkert-gaten 13. august, de tre siste i P-2. Fem flater, én gate hver, samme
// to helpere (lib/public-snapshot.ts og lib/live-premium.ts). Kommer en sjette
// til, skal den gå gjennom de samme to.
//
// Cache-Control settes av decideStandingsCache (lib/standings-cache.ts) — se den
// filen for hvorfor en stengt quiz IKKE får `immutable`, og hvorfor revalidateTag
// ikke er en brukbar invalideringsmekanisme her.

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ top3: [], placement: null }, { headers: NO_STORE })

  const { searchParams } = new URL(request.url)
  const attemptId    = searchParams.get('attemptId')
  const attemptToken = request.headers.get('x-attempt-token')
  // `question` sendes fortsatt av klienten, men påvirker ikke lenger cache-nøkkelen
  // (snapshoten er uavhengig av spørsmålsindeks — se lib/ranking-snapshot.ts).
  const correct      = parseInt(searchParams.get('correct') ?? '0', 10)
  const time         = parseInt(searchParams.get('time') ?? '0', 10)

  // Personlig = svaret er formet av spiller-spesifikke parametere. Basert på om
  // parameteren FANTES, ikke på den parsede verdien: `?correct=0` er fortsatt et
  // spiller-spesifikt kall, selv om 0 er samme tall som defaulten.
  const personalized =
    attemptId !== null ||
    searchParams.get('correct') !== null ||
    searchParams.get('time') !== null

  let snapshot: SnapshotEntry[]
  let closesAt: string | null = null
  let seasonPointsAwarded = false
  try {
    // Snapshoten og quiz-raden hentes PARALLELT. closes_at trengs kun for å
    // velge cache-header, season_points_awarded for blokkert-settets
    // «historikken står som den var»-gren — ingen av dem skal koste en ekstra
    // rundtur på toppen av de 1–3 getOrBuildSnapshot allerede gjør.
    //
    // ensureAttemptId: hvis spilleren nettopp leverte og cachen ikke har dem
    // ennå, beregnes snapshoten på nytt slik at de er med i BÅDE topp-3 og
    // plasseringen. Den tvungne rebuilden skrives IKKE tilbake til DB-cachen
    // (se lib/ranking-snapshot.ts) — ellers ville hver innsending i sluttminuttene
    // utløst en full JSONB-UPDATE. Ellers brukes cachen som normalt.
    const [snap, quizRes] = await Promise.all([
      getOrBuildSnapshot(quizId, { ensureAttemptId: attemptId }),
      supabaseAdmin.from('quizzes').select('closes_at, season_points_awarded').eq('id', quizId).maybeSingle(),
    ])
    snapshot = snap
    closesAt = (quizRes.data?.closes_at as string | null) ?? null
    seasonPointsAwarded = quizRes.data?.season_points_awarded === true
  } catch (err) {
    console.error('[quiz/standings] snapshot feilet:', err)
    // Et tomt nødsvar skal ALDRI caches — ellers ville en forbigående feil blitt
    // servert videre som om den var quizens faktiske toppliste.
    return NextResponse.json({ top3: [], placement: null }, { headers: NO_STORE })
  }

  const cacheControl = decideStandingsCache({
    closesAt,
    personalized,
    now: Date.now(),
  })

  // ── Global synlighets-gate — samme delte sett som leaderboard-ruten ────────
  // Filter + posisjonell re-rank bor i lib/public-snapshot.ts, ikke her. Det ble
  // skrevet fordi tre andre flater (social-proof, rival, live-ranking) skulle
  // gates senere, og en håndskrevet kopi per flate ville vært tre sjanser til å
  // avvike. Alle tre er nå på plass og bruker den samme helperen — regningen for
  // den utflyttingen er betalt. `snapshot` er fortsatt det UFILTRERTE feltet —
  // se egen plassering nederst.
  //
  // Snapshoten hentes bevisst utenfor helperen (Promise.all over) fordi
  // `season_points_awarded` kommer fra samme quiz-rad som `closes_at`; en
  // `getPublicSnapshot(quizId)` her ville gjort de to rundturene serielle.
  const { publicSnapshot, blocked } = await filterSnapshotToPublic(
    quizId,
    snapshot,
    seasonPointsAwarded,
  )

  // ── Topp 3 fra den SYNLIGE delen av den delte lista ─────────────────────────
  const top3Entries = publicSnapshot.slice(0, 3)
  const userIds = top3Entries.map(r => r.user_id).filter((id): id is string => !!id)
  const nickMap = new Map<string, string | null>()
  if (userIds.length > 0) {
    const { data: profs } = await supabaseAdmin
      .from('profiles')
      .select('id, nickname')
      .in('id', userIds)
    for (const p of (profs ?? []) as { id: string; nickname: string | null }[]) {
      nickMap.set(p.id, p.nickname ?? null)
    }
  }
  const top3 = top3Entries.map(r => ({
    id: r.id,
    player_name: r.player_name,
    correct_answers: r.correct_answers,
    total_time_ms: r.total_time_ms,
    nickname: r.user_id ? (nickMap.get(r.user_id) ?? null) : null,
  }))

  // ── Spillerens egen plassering fra SAMME liste ──────────────────────────────
  // playerInPool: true — på resultatskjermen er spilleren (normalt) i lista;
  // computePlacement bruker da deres egen rank (identisk med topp-3), og
  // garanterer rang <= total (Del A) også hvis de mot formodning mangler.
  //
  // En BLOKKERT kaller finnes ikke i det synlige feltet — deres plassering
  // regnes mot det ufiltrerte (rank og total mot hele feltet, som før gaten).
  // Klientens placement-visibility-lag viser uansett det interne tallet i
  // stedet; dette svaret bærer «egne tall» for den som spør, ikke andres.
  const selfEntry = attemptId ? snapshot.find(e => e.id === attemptId) ?? null : null
  const callerBlocked = !!(selfEntry?.user_id && blocked.has(selfEntry.user_id))
  const placementPool = callerBlocked ? snapshot : publicSnapshot

  // Punkt (a) i toppkommentaren: ingen plassering på et upersonlig kall. Den
  // ville uansett vært et tall for en spiller som ikke finnes.
  const rawPlacement = personalized && placementPool.length > 0
    ? computePlacement(placementPool, { attemptId, correct, time, playerInPool: true })
    : null

  // Eksakt `rank` og nabonavnene kun til Premium — samme delte formings-
  // funksjon som ranking-snapshot og live-ranking bruker, slik at de tre ikke
  // kan gli fra hverandre. `low`/`high`/`total` går som før til alle, og er det
  // gratis-kortet på resultatskjermen allerede bygger på.
  const placement = rawPlacement
    ? gatePlacement(rawPlacement, attemptIsPremium({ quizId, attemptId, token: attemptToken }))
    : null

  return NextResponse.json({ top3, placement }, { headers: { 'Cache-Control': cacheControl } })
}
