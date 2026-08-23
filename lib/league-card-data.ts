import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows, fetchAllRowsChunked } from '@/lib/paginate'

export type LeagueCardResult = {
  id: string
  name: string
  top3: { displayName: string; value: number }[]
  fromFallback: boolean
}

// Embedden types `unknown` og smalnes ved lesing — samme mønster og
// begrunnelse som i lib/monthly-standings.ts.
type LeagueScoreRow = { user_id: string; points: number; profiles: unknown }
type AttemptFallback = { user_id: string; correct_answers: number; total_time_ms: number }

// Liga-kortet på forsiden: månedens topp 3 fra season_scores, med fallback til
// rå attempts mens quizen er åpen (før poengene er gjort opp).
//
// Paginert (23. august 2026) — flyttet ut av app/page.tsx i samme slengen for
// å kunne testes: alle tre lesingene var rå (1000-radstaket), attempts-
// fallbacken hadde i tillegg et uchunket `.in(memberIds)` (URL-taket ~390, se
// lib/paginate.ts) med ULEST error — en liga over taket ville fått et stille
// tomt/feil kort.
//
// Kaster ved lesefeil — forsiden fanger per kort og viser det tomme kortet,
// men logger høylytt i stedet for at feilen forkles som «ingen poeng ennå»
// (som i tillegg sendte spørringen videre inn i attempts-fallbacken).
export async function getLeagueCardData(
  league: { id: string; name: string },
  activeQuizId: string | null,
  monthStart: string,
  monthEnd: string,
): Promise<LeagueCardResult> {
  const leagueScores = await fetchAllRows<LeagueScoreRow>((from, to) =>
    supabaseAdmin
      .from('season_scores')
      .select('user_id, points, profiles(display_name)')
      .eq('scope_type', 'league')
      .eq('scope_id', league.id)
      .gte('closes_at', monthStart)
      .lt('closes_at', monthEnd)
      .order('id')
      .range(from, to)
  )

  const lByUser = new Map<string, { displayName: string; points: number }>()
  for (const row of leagueScores) {
    const name = (row.profiles as { display_name: string | null } | null)?.display_name
    if (!name) continue
    const existing = lByUser.get(row.user_id)
    if (existing) existing.points += row.points
    else lByUser.set(row.user_id, { displayName: name, points: row.points })
  }

  if (lByUser.size > 0) {
    const top3 = Array.from(lByUser.values())
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map(e => ({ displayName: e.displayName, value: e.points }))
    return { id: league.id, name: league.name, top3, fromFallback: false }
  }

  // Fallback: quizen er åpen — les direkte fra attempts
  if (activeQuizId) {
    const memberRows = await fetchAllRows<{ user_id: string }>((from, to) =>
      supabaseAdmin
        .from('league_members')
        .select('user_id')
        .eq('league_id', league.id)
        .order('user_id')
        .range(from, to)
    )
    const memberIds = memberRows.map(m => m.user_id)

    if (memberIds.length > 0) {
      const attemptRows = await fetchAllRowsChunked<AttemptFallback>(memberIds, (chunk, from, to) =>
        supabaseAdmin
          .from('attempts')
          .select('user_id, correct_answers, total_time_ms')
          .eq('quiz_id', activeQuizId)
          .in('user_id', chunk)
          .eq('is_team', false)
          .not('user_id', 'is', null)
          .order('id')
          .range(from, to)
      )

      const bestByUser = new Map<string, AttemptFallback>()
      for (const a of attemptRows) {
        const existing = bestByUser.get(a.user_id)
        if (
          !existing ||
          a.correct_answers > existing.correct_answers ||
          (a.correct_answers === existing.correct_answers && a.total_time_ms < existing.total_time_ms)
        ) {
          bestByUser.set(a.user_id, a)
        }
      }

      if (bestByUser.size > 0) {
        const sortedFallback = [...bestByUser.values()]
          .sort((a, b) =>
            b.correct_answers !== a.correct_answers
              ? b.correct_answers - a.correct_answers
              : a.total_time_ms - b.total_time_ms
          )
          .slice(0, 3)

        // Maks 3 id-er — trygt under URL-taket uten chunking. Feiler oppslaget,
        // faller navnene til 'Spiller' (som før), men logget — ikke stille.
        const topIds = sortedFallback.map(a => a.user_id)
        const { data: profileRows, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('id, display_name')
          .in('id', topIds)
        if (profileError) {
          console.error(`[liga-kort] profiloppslag feilet league=${league.id}:`, profileError.message)
        }

        const profileMap = new Map(
          ((profileRows ?? []) as { id: string; display_name: string | null }[])
            .map(p => [p.id, p.display_name])
        )

        const top3 = sortedFallback.map(a => ({
          displayName: profileMap.get(a.user_id) ?? 'Spiller',
          value: a.correct_answers,
        }))
        return { id: league.id, name: league.name, top3, fromFallback: true }
      }
    }
  }

  return { id: league.id, name: league.name, top3: [], fromFallback: false }
}
