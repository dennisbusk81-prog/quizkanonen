// Delt logikk for tildeling av sesongpoeng — brukes av:
//   - /api/cron/award-season-points  (poller hvert 5. minutt)
//   - /api/cron/publish-quiz         (kaller umiddelbart når en quiz stenges)
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getSeasonPoints as getPoints,
  pickBestSeasonAttempt as pickBestAttempt,
  rankSeasonAttempts as rankBestAttempts,
  type SeasonAttempt as RawAttempt,
} from '@/lib/season-points'

type ScoreRow = {
  user_id: string
  quiz_id: string
  scope_type: string
  scope_id: string | null
  points: number
  rank: number
  closes_at: string
}

async function upsertScores(rows: ScoreRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin
    .from('season_scores')
    .upsert(rows, {
      onConflict: 'user_id,quiz_id,scope_type,scope_id',
      ignoreDuplicates: true,
    })
  if (error) throw error
}

export async function processQuiz(
  quizId: string,
  closesAt: string
): Promise<{ rows: number; error: string | null }> {
  const { data: rawAttempts, error: attError } = await supabaseAdmin
    .from('attempts')
    .select('user_id, correct_answers, total_time_ms, correct_streak')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)

  if (attError) return { rows: 0, error: attError.message }

  if (!rawAttempts || rawAttempts.length === 0) {
    await supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: true })
      .eq('id', quizId)
    return { rows: 0, error: null }
  }

  const bestByUser = new Map<string, RawAttempt>()
  for (const a of rawAttempts as RawAttempt[]) {
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) : a)
  }

  const userIds = [...bestByUser.keys()]

  // Brukere blokkeres fra global-rad hvis org har allow_global_league=false
  // eller memberen selv har global_league_opt_out=true. org-medlemskapet hentes
  // ÉN gang her og gjenbrukes for organization-scope lenger ned (fjerner tidligere
  // duplikat-lesing av organization_members).
  type Mem = { user_id: string; organization_id: string; global_league_opt_out: boolean | null }
  const globallyBlockedUserIds = new Set<string>()
  let orgMemberships: Mem[] = []
  if (userIds.length > 0) {
    const { data: orgMems } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, organization_id, global_league_opt_out')
      .in('user_id', userIds)
    orgMemberships = (orgMems ?? []) as Mem[]
    if (orgMemberships.length > 0) {
      const orgIds = [...new Set(orgMemberships.map(m => m.organization_id))]
      const { data: restrictedOrgs } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .in('id', orgIds)
        .eq('allow_global_league', false)
      const restrictedOrgIds = new Set(((restrictedOrgs ?? []) as { id: string }[]).map(o => o.id))
      for (const m of orgMemberships) {
        if (restrictedOrgIds.has(m.organization_id) || m.global_league_opt_out === true) {
          globallyBlockedUserIds.add(m.user_id)
        }
      }
    }
  }

  // Del 1: akkumuler ALLE rader (global + liga + org) og gjør ÉN upsert til slutt.
  const allRows: ScoreRow[] = []

  try {
    // ── Global scope ───────────────────────────────────────────────────────────
    const globalRanked = rankBestAttempts(bestByUser)
    const globalRows: ScoreRow[] = globalRanked
      .filter(({ userId }) => !globallyBlockedUserIds.has(userId))
      .map(({ userId, rank }) => ({
        user_id: userId,
        quiz_id: quizId,
        scope_type: 'global',
        scope_id: null,
        points: getPoints(rank),
        rank,
        closes_at: closesAt,
      }))
    allRows.push(...globalRows)
    console.log(`[award-season-points]   global: ${globalRows.length} rader`)

    // ── League scope ───────────────────────────────────────────────────────────
    const { data: leagueMemberships } = await supabaseAdmin
      .from('league_members')
      .select('league_id, user_id')
      .in('user_id', userIds)

    if (leagueMemberships && leagueMemberships.length > 0) {
      const byLeague = new Map<string, string[]>()
      for (const lm of leagueMemberships as { league_id: string; user_id: string }[]) {
        if (!byLeague.has(lm.league_id)) byLeague.set(lm.league_id, [])
        byLeague.get(lm.league_id)!.push(lm.user_id)
      }

      for (const [leagueId, memberIds] of byLeague) {
        const leagueBest = new Map<string, RawAttempt>()
        for (const uid of memberIds) {
          const a = bestByUser.get(uid)
          if (a) leagueBest.set(uid, a)
        }
        if (leagueBest.size === 0) continue

        const ranked = rankBestAttempts(leagueBest)
        const rows: ScoreRow[] = ranked.map(({ userId, rank }) => ({
          user_id: userId,
          quiz_id: quizId,
          scope_type: 'league',
          scope_id: leagueId,
          points: getPoints(rank),
          rank,
          closes_at: closesAt,
        }))
        allRows.push(...rows)
      }
      console.log(`[award-season-points]   league: ${byLeague.size} ligaer`)
    }

    // ── Organization scope (gjenbruker orgMemberships hentet over) ──────────────
    if (orgMemberships.length > 0) {
      const byOrg = new Map<string, string[]>()
      for (const om of orgMemberships) {
        if (!byOrg.has(om.organization_id)) byOrg.set(om.organization_id, [])
        byOrg.get(om.organization_id)!.push(om.user_id)
      }

      for (const [orgId, memberIds] of byOrg) {
        const orgBest = new Map<string, RawAttempt>()
        for (const uid of memberIds) {
          const a = bestByUser.get(uid)
          if (a) orgBest.set(uid, a)
        }
        if (orgBest.size === 0) continue

        const ranked = rankBestAttempts(orgBest)
        const rows: ScoreRow[] = ranked.map(({ userId, rank }) => ({
          user_id: userId,
          quiz_id: quizId,
          scope_type: 'organization',
          scope_id: orgId,
          points: getPoints(rank),
          rank,
          closes_at: closesAt,
        }))
        allRows.push(...rows)
      }
      console.log(`[award-season-points]   org: ${byOrg.size} organisasjoner`)
    }

    // ── ÉN samlet upsert for alle scopes ────────────────────────────────────────
    // Unik-nøkkelen (user_id, quiz_id, scope_type, scope_id) skiller radene uansett
    // rekkefølge, så én upsert er ekvivalent med de tidligere per-scope-kallene —
    // bare ett round-trip i stedet for 4-9. Identisk poeng/rank per bruker/scope.
    await upsertScores(allRows)

    // Verifiser at rader faktisk finnes i season_scores før flagget settes
    const { count: writtenCount, error: countError } = await supabaseAdmin
      .from('season_scores')
      .select('id', { count: 'exact', head: true })
      .eq('quiz_id', quizId)

    if (countError || writtenCount === null || writtenCount === 0) {
      const reason = countError?.message ?? 'Ingen rader funnet i season_scores etter upsert'
      console.error(`[award-season-points] Verifisering feilet for quiz ${quizId}: ${reason}`)
      return { rows: allRows.length, error: reason }
    }

    const { error: flagError } = await supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: true })
      .eq('id', quizId)

    if (flagError) {
      console.error(`[award-season-points] Klarte ikke sette season_points_awarded på quiz ${quizId}:`, flagError.message)
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[award-season-points] Upsert feil på quiz ${quizId}:`, errMsg)
    return { rows: allRows.length, error: errMsg }
  }

  return { rows: allRows.length, error: null }
}
