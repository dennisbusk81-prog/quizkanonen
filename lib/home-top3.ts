import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'
import { rankQuizAttempts, type RankableAttempt } from '@/lib/ranking'
import { getGloballyBlockedSet } from '@/lib/globally-blocked-set'

export type HomeTop3Row = {
  player_name: string
  correct_answers: number
  total_time_ms: number
  nickname: string | null
}

// «Forrige uke — hvem vant?» på forsiden — trukket ut av computeSharedHomeData
// 24. august 2026 (gruppe B2 i kartleggingen samme dag).
//
// Spørringen var rå: hardkodet .limit(3) uten blokkert-gate, uten
// submitted-filter og uten dedup per spiller. En bruker som hadde valgt bort
// offentlig synlighet (org med allow_global_league=false, eller eget opt-out)
// kunne dermed stå med navn på den mest sette flaten i appen — samtidig som
// /leaderboard/[id], som kortet lenker rett til, filtrerte samme person bort.
//
// Nå: samme gate og samme rangering som den nasjonale stien i
// /api/leaderboard/[id] (og toppliste sin «Siste quiz»-fane):
//   • getGloballyBlockedSet — «historikken står som den var»-semantikken og
//     fail-STENGT-retningen ligger i lib-en, ikke her.
//   • rankQuizAttempts med includeGuests:true + requireSubmitted:true —
//     identisk topp 3 som siden lenken går til.
//   • Gjester (user_id null) berøres aldri av gaten.
//
// VIKTIG: hele feltet hentes (paginert) FØR filtrering og slicing. En
// .limit(3) før gaten ville gitt to navn når én av de tre var blokkert —
// utvalget må være større enn det som vises. Kostnaden er lav: kalleren er
// cachet 60 s (unstable_cache), så dette løper ikke per sidelast.
//
// Kaster ved lesefeil på attempts — kalleren (forsiden) avgjør degraderingen,
// samme mønster som lib/monthly-standings. Profilnavn-oppslaget degraderer
// derimot lokalt til attempts.player_name (navnet spilleren faktisk spilte
// under) — feil topp-3-UTVALG skal aldri serveres, et mindre polert NAVN kan.
export async function getLastQuizTop3(
  quizId: string,
  seasonPointsAwarded: boolean,
): Promise<HomeTop3Row[]> {
  const rows = await fetchAllRows<RankableAttempt>((from, to) =>
    supabaseAdmin
      .from('attempts')
      .select('id, user_id, player_name, correct_answers, total_time_ms, correct_streak, submitted_at')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .order('id')
      .range(from, to)
  )

  const attemptUserIds = [...new Set(
    rows.map(r => r.user_id).filter((id): id is string => !!id)
  )]
  const blocked = attemptUserIds.length > 0
    ? await getGloballyBlockedSet(quizId, attemptUserIds, seasonPointsAwarded)
    : new Set<string>()

  const publicRows = blocked.size > 0
    ? rows.filter(r => r.user_id == null || !blocked.has(r.user_id))
    : rows

  const top3 = rankQuizAttempts(publicRows, { includeGuests: true, requireSubmitted: true })
    .slice(0, 3)

  const userIds = top3.map(r => r.user_id).filter((id): id is string => !!id)
  const profileMap = new Map<string, { displayName: string | null; nickname: string | null }>()
  if (userIds.length > 0) {
    const { data: profilesRaw, error } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, nickname')
      .in('id', userIds)
    if (error) console.error('[home-top3] profiloppslag feilet, viser player_name:', error.message)
    for (const p of ((profilesRaw ?? []) as { id: string; display_name: string | null; nickname: string | null }[])) {
      profileMap.set(p.id, { displayName: p.display_name, nickname: p.nickname ?? null })
    }
  }

  return top3.map(r => {
    const prof = r.user_id ? profileMap.get(r.user_id) : null
    return {
      player_name: prof?.displayName ?? r.player_name,
      correct_answers: r.correct_answers,
      total_time_ms: r.total_time_ms,
      nickname: prof?.nickname ?? null,
    }
  })
}
