import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getSeasonPoints as getPoints,
  pickBestSeasonAttempt as pickBestAttempt,
  rankSeasonAttempts as rankBestAttempts,
  type SeasonAttempt as RawAttempt,
} from '@/lib/season-points'

const BATCH_SIZE = 10

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

async function processQuiz(
  quizId: string,
  closesAt: string
): Promise<{ rows: number; error: string | null }> {
  // Hent alle solo innloggede forsøk for quizen
  const { data: rawAttempts, error: attError } = await supabaseAdmin
    .from('attempts')
    .select('user_id, correct_answers, total_time_ms, correct_streak')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)

  if (attError) return { rows: 0, error: attError.message }

  if (!rawAttempts || rawAttempts.length === 0) {
    // Ingen forsøk — marker som ferdig
    await supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: true })
      .eq('id', quizId)
    return { rows: 0, error: null }
  }

  // Beste forsøk per bruker
  const bestByUser = new Map<string, RawAttempt>()
  for (const a of rawAttempts as RawAttempt[]) {
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) : a)
  }

  const userIds = [...bestByUser.keys()]

  // Brukere skal ikke ha global-rad hvis EN av disse er sanne for noen org de
  // tilhører: (a) organisasjonens allow_global_league=false (org-tak), eller
  // (b) brukerens egen membership har global_league_opt_out=true (individuelt
  // fravalg). Mest restriktiv vinner — begge er uavhengige blokkeringsgrunner.
  const globallyBlockedUserIds = new Set<string>()
  if (userIds.length > 0) {
    const { data: orgMems } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, organization_id, global_league_opt_out')
      .in('user_id', userIds)
    if (orgMems && orgMems.length > 0) {
      type Mem = { user_id: string; organization_id: string; global_league_opt_out: boolean | null }
      const orgIds = [...new Set((orgMems as Mem[]).map(m => m.organization_id))]
      const { data: restrictedOrgs } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .in('id', orgIds)
        .eq('allow_global_league', false)
      const restrictedOrgIds = new Set(((restrictedOrgs ?? []) as { id: string }[]).map(o => o.id))
      for (const m of orgMems as Mem[]) {
        if (restrictedOrgIds.has(m.organization_id) || m.global_league_opt_out === true) {
          globallyBlockedUserIds.add(m.user_id)
        }
      }
    }
  }

  let totalRows = 0

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
    await upsertScores(globalRows)
    totalRows += globalRows.length
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
        await upsertScores(rows)
        totalRows += rows.length
      }
      console.log(`[award-season-points]   league: ${byLeague.size} ligaer, scope-rader inkludert i total`)
    }

    // ── Organization scope ─────────────────────────────────────────────────────
    const { data: orgMemberships } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id, user_id')
      .in('user_id', userIds)

    if (orgMemberships && orgMemberships.length > 0) {
      const byOrg = new Map<string, string[]>()
      for (const om of orgMemberships as { organization_id: string; user_id: string }[]) {
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
        await upsertScores(rows)
        totalRows += rows.length
      }
      console.log(`[award-season-points]   org: ${byOrg.size} organisasjoner, scope-rader inkludert i total`)
    }

    // Verifiser at rader faktisk finnes i season_scores før flagget settes
    const { count: writtenCount, error: countError } = await supabaseAdmin
      .from('season_scores')
      .select('id', { count: 'exact', head: true })
      .eq('quiz_id', quizId)

    if (countError || writtenCount === null || writtenCount === 0) {
      const reason = countError?.message ?? 'Ingen rader funnet i season_scores etter upsert'
      console.error(`[award-season-points] Verifisering feilet for quiz ${quizId}: ${reason}`)
      return { rows: totalRows, error: reason }
    }

    // Alle rader bekreftet — sett flagget
    const { error: flagError } = await supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: true })
      .eq('id', quizId)

    if (flagError) {
      // Scores er skrevet og bekreftet — logg men la cronen prøve flagget igjen
      console.error(`[award-season-points] Klarte ikke sette season_points_awarded på quiz ${quizId}:`, flagError.message)
    }

  } catch (err) {
    // Upsert feil — season_points_awarded forblir false, cron prøver igjen om 5 min
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[award-season-points] Upsert feil på quiz ${quizId}:`, errMsg)
    return { rows: totalRows, error: errMsg }
  }

  return { rows: totalRows, error: null }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  // Finn ubehandlede quizer som har stengt
  const { data: quizzes, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .order('closes_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (quizError) {
    console.error('[award-season-points] Klarte ikke hente quizer:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 500 })
  }

  if (!quizzes || quizzes.length === 0) {
    return NextResponse.json({ processed: 0, totalRows: 0, quizzes: [] })
  }

  const results: Array<{ quizId: string; title: string; rows: number; error: string | null }> = []
  let totalRows = 0

  for (const quiz of quizzes as { id: string; title: string; closes_at: string }[]) {
    console.log(`[award-season-points] Behandler: "${quiz.title}" (${quiz.id})`)
    const { rows, error } = await processQuiz(quiz.id, quiz.closes_at)
    totalRows += rows
    results.push({ quizId: quiz.id, title: quiz.title, rows, error })
    if (error) {
      console.error(`[award-season-points] Feil på "${quiz.title}":`, error)
    } else {
      console.log(`[award-season-points] Ferdig: "${quiz.title}" — ${rows} rader totalt`)
    }
  }

  return NextResponse.json({ processed: results.length, totalRows, quizzes: results })
}
