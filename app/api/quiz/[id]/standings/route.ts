import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrBuildSnapshot, computePlacement } from '@/lib/ranking-snapshot'
import { decideStandingsCache } from '@/lib/standings-cache'

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
// Cache-Control settes av decideStandingsCache (lib/standings-cache.ts) — se den
// filen for hvorfor en stengt quiz IKKE får `immutable`, og hvorfor revalidateTag
// ikke er en brukbar invalideringsmekanisme her.

const NO_STORE = { 'Cache-Control': 'private, no-store' }

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

  let snapshot
  let closesAt: string | null = null
  try {
    // Snapshoten og quiz-vinduet hentes PARALLELT. Vinduet trengs kun for å
    // velge cache-header, og skal derfor ikke koste en ekstra rundtur på toppen
    // av de 1–3 getOrBuildSnapshot allerede gjør — hele poenget med endringen er
    // å gjøre denne ruten raskere, ikke å legge til nok et sekvensielt kall.
    //
    // ensureAttemptId: hvis spilleren nettopp leverte og cachen ikke har dem
    // ennå, beregnes snapshoten på nytt slik at de er med i BÅDE topp-3 og
    // plasseringen. Den tvungne rebuilden skrives IKKE tilbake til DB-cachen
    // (se lib/ranking-snapshot.ts) — ellers ville hver innsending i sluttminuttene
    // utløst en full JSONB-UPDATE. Ellers brukes cachen som normalt.
    const [snap, quizRes] = await Promise.all([
      getOrBuildSnapshot(quizId, { ensureAttemptId: attemptId }),
      supabaseAdmin.from('quizzes').select('closes_at').eq('id', quizId).maybeSingle(),
    ])
    snapshot = snap
    closesAt = (quizRes.data?.closes_at as string | null) ?? null
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

  // ── Topp 3 fra den delte lista ──────────────────────────────────────────────
  const top3Entries = snapshot.slice(0, 3)
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
  const placement = snapshot.length > 0
    ? computePlacement(snapshot, { attemptId, correct, time, playerInPool: true })
    : null

  return NextResponse.json({ top3, placement }, { headers: { 'Cache-Control': cacheControl } })
}
