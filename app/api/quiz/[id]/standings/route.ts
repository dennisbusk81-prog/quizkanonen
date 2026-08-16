import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrBuildSnapshot, computePlacement, type SnapshotEntry } from '@/lib/ranking-snapshot'
import { decideStandingsCache } from '@/lib/standings-cache'
import { filterSnapshotToPublic } from '@/lib/public-snapshot'

// ── Ett felles endepunkt for resultatskjermen ────────────────────────────────
// Returnerer BÅDE topp-3 OG spillerens egen plassering, utledet fra ÉN felles
// rangert liste (getOrBuildSnapshot) i SAMME request. Dermed er det strukturelt
// umulig at "Topp 3 denne uken" og "Din plassering" viser ulike tall samtidig —
// de kommer fra samme øyeblikksbilde og samme rangeringsfunksjon.
//
// Tilgjengelig for alle. Klienten avgjør visning: Premium ser eksakt `rank`,
// gratis ser et spenn (low/high). `rank` lå allerede i det gamle snapshot-svaret,
// så dette endrer ikke paywall-eksponeringen.
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
// Merk: live-flatene under spilling (live-ranking, ranking-snapshot, rival,
// social-proof) er BEVISST ikke gatet her — de reiser egne designspørsmål og
// tas separat. Denne ruten er den eneste av de fire som mater et tall brukeren
// ser ETTER quizen og deler videre.
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
  // Filter + posisjonell re-rank bor i lib/public-snapshot.ts, ikke her: tre
  // andre flater (social-proof, rival, live-ranking) skal gates senere, og en
  // håndskrevet kopi per flate er tre sjanser til å avvike. `snapshot` er
  // fortsatt det UFILTRERTE feltet — se egen plassering nederst.
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
  const placement = placementPool.length > 0
    ? computePlacement(placementPool, { attemptId, correct, time, playerInPool: true })
    : null

  return NextResponse.json({ top3, placement }, { headers: { 'Cache-Control': cacheControl } })
}
