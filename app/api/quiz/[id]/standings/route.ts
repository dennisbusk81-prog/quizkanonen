import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrBuildSnapshot, computePlacement } from '@/lib/ranking-snapshot'

// ── Ett felles endepunkt for resultatskjermen ────────────────────────────────
// Returnerer BÅDE topp-3 OG spillerens egen plassering, utledet fra ÉN felles
// rangert liste (getOrBuildSnapshot) i SAMME request. Dermed er det strukturelt
// umulig at "Topp 3 denne uken" og "Din plassering" viser ulike tall samtidig —
// de kommer fra samme øyeblikksbilde og samme rangeringsfunksjon.
//
// Tilgjengelig for alle. Klienten avgjør visning: Premium ser eksakt `rank`,
// gratis ser et spenn (low/high). `rank` lå allerede i det gamle snapshot-svaret,
// så dette endrer ikke paywall-eksponeringen.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ top3: [], placement: null })

  const { searchParams } = new URL(request.url)
  const attemptId    = searchParams.get('attemptId')
  const questionIndex = parseInt(searchParams.get('question') ?? '0', 10)
  const correct      = parseInt(searchParams.get('correct') ?? '0', 10)
  const time         = parseInt(searchParams.get('time') ?? '0', 10)

  let snapshot
  try {
    // ensureAttemptId: hvis spilleren nettopp leverte og cachen ikke har dem
    // ennå, bygges snapshoten på nytt slik at de er med i BÅDE topp-3 og
    // plasseringen. Ellers brukes cachen (amortisering — ingen per-visning-skann).
    snapshot = await getOrBuildSnapshot(quizId, isNaN(questionIndex) ? 0 : questionIndex, {
      ensureAttemptId: attemptId,
    })
  } catch (err) {
    console.error('[quiz/standings] snapshot feilet:', err)
    return NextResponse.json({ top3: [], placement: null })
  }

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

  return NextResponse.json({ top3, placement })
}
