import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Ranking helpers (brukes av last_quiz-modus) ───────────────────────────────

type RawAttempt = {
  user_id: string
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
}

function pickBestAttempt(existing: RawAttempt, challenger: RawAttempt): RawAttempt {
  if (challenger.correct_answers > existing.correct_answers) return challenger
  if (challenger.correct_answers === existing.correct_answers && challenger.total_time_ms < existing.total_time_ms) return challenger
  if (
    challenger.correct_answers === existing.correct_answers &&
    challenger.total_time_ms === existing.total_time_ms &&
    (challenger.correct_streak ?? 0) > (existing.correct_streak ?? 0)
  ) return challenger
  return existing
}

function rankAttempts(attempts: RawAttempt[]): Array<RawAttempt & { rank: number }> {
  const sorted = [...attempts].sort((a, b) => {
    if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers
    if (a.total_time_ms !== b.total_time_ms) return a.total_time_ms - b.total_time_ms
    return (b.correct_streak ?? 0) - (a.correct_streak ?? 0)
  })
  const withRanks: Array<RawAttempt & { rank: number }> = []
  for (let i = 0; i < sorted.length; i++) {
    let rank = i + 1
    if (i > 0) {
      const prev = sorted[i - 1]
      if (sorted[i].correct_answers === prev.correct_answers && sorted[i].total_time_ms === prev.total_time_ms) {
        rank = withRanks[i - 1].rank
      }
    }
    withRanks.push({ ...sorted[i], rank })
  }
  return withRanks
}

// ── Period helpers ────────────────────────────────────────────────────────────

function getPeriodStart(period: string): string {
  const now = new Date()
  let d: Date
  if (period === 'month') {
    d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  } else if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3)
    d = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1))
  } else if (period === 'year') {
    d = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  } else {
    return new Date(0).toISOString() // alltime
  }
  return d.toISOString()
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const t0 = Date.now()
  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') ?? 'month'

  if (!['month', 'quarter', 'year', 'alltime', 'last_quiz'].includes(period)) {
    return NextResponse.json({ error: 'Ugyldig periode' }, { status: 400 })
  }

  // scope params — brukes av liga/org i Økt 4/5, global er default
  const scope   = searchParams.get('scope')    ?? 'global'
  const scopeId = searchParams.get('scope_id') ?? null

  // Eksplisitt datoperiode — brukes av historikk-accordion
  const periodStartParam = searchParams.get('period_start')
  const periodEndParam   = searchParams.get('period_end')

  // Identify user + bygg excludedSet — kjør alle uavhengige queries parallelt
  let userId: string | null = null
  let userIsPremium = false
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  const nowIso = new Date().toISOString()

  let excludedQuery = supabaseAdmin
    .from('excluded_members')
    .select('user_id')
    .eq('scope_type', scope)
  if (scopeId) excludedQuery = excludedQuery.eq('scope_id', scopeId)
  else         excludedQuery = excludedQuery.is('scope_id', null)

  const [authResult, excludedResult, suspendedResult] = await Promise.all([
    token
      ? supabaseAdmin.auth.getUser(token)
      : Promise.resolve({ data: { user: null }, error: null }),
    excludedQuery,
    supabaseAdmin.from('profiles').select('id').gt('suspended_until', nowIso),
  ])

  userId = authResult.data.user?.id ?? null

  const excludedSet = new Set(
    (excludedResult.data ?? []).map((e: { user_id: string }) => e.user_id)
  )
  for (const row of (suspendedResult.data ?? []) as { id: string }[]) {
    excludedSet.add(row.id)
  }

  // ── LAST QUIZ MODE ──────────────────────────────────────────────────────────
  if (period === 'last_quiz') {
    // Hent nyeste quiz som faktisk har minst én attempt (INNER JOIN).
    // Uten dette vil testquizer med closes_at i fremtiden og 0 attempts
    // skygge for quizer der folk faktisk har spilt.
    const { data: latestQuiz } = await supabaseAdmin
      .from('quizzes')
      .select('id, title, closes_at, attempts!inner(id)')
      .eq('quiz_type', 'weekly')
      .order('closes_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latestQuiz) {
      return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: null })
    }

    const { data: rawAttempts } = await supabaseAdmin
      .from('attempts')
      .select('user_id, player_name, correct_answers, total_time_ms, correct_streak')
      .eq('quiz_id', latestQuiz.id)
      .not('user_id', 'is', null)
      .eq('is_team', false)

    if (!rawAttempts || rawAttempts.length === 0) {
      return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: latestQuiz.title })
    }

    // For league/org scopes: filter attempts to members only
    let memberSet: Set<string> | null = null
    if (scope === 'league' && scopeId) {
      const { data: leagueMembers } = await supabaseAdmin
        .from('league_members')
        .select('user_id')
        .eq('league_id', scopeId)
      memberSet = new Set((leagueMembers ?? []).map((m: { user_id: string }) => m.user_id))
    } else if (scope === 'organization' && scopeId) {
      const { data: orgMembers } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', scopeId)
      memberSet = new Set((orgMembers ?? []).map((m: { user_id: string }) => m.user_id))
    }

    const bestByUser = new Map<string, RawAttempt>()
    for (const a of rawAttempts as RawAttempt[]) {
      if (excludedSet.has(a.user_id)) continue
      if (memberSet && !memberSet.has(a.user_id)) continue
      const existing = bestByUser.get(a.user_id)
      bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) : a)
    }

    const withRanks = rankAttempts([...bestByUser.values()])

    const top10Ids = withRanks.slice(0, 10).map(a => a.user_id)
    // Inkluder alltid userId for å hente premium_status i samme query (erstatter separat oppslag)
    const profileIdsSet = new Set(top10Ids)
    if (userId) profileIdsSet.add(userId)
    const profileIds = [...profileIdsSet]

    const { data: profiles } = profileIds.length > 0
      ? await supabaseAdmin.from('profiles').select('id, display_name, premium_status').in('id', profileIds)
      : { data: [] }

    const profileMap = new Map<string, { display_name: string | null }>()
    for (const p of (profiles ?? []) as { id: string; display_name: string | null; premium_status: boolean | null }[]) {
      profileMap.set(p.id, p)
      if (p.id === userId) userIsPremium = p.premium_status === true
    }

    const entries = withRanks.slice(0, 10).map(a => {
      const profile = profileMap.get(a.user_id)
      return {
        rank: a.rank,
        userId: a.user_id,
        displayName: profile?.display_name ?? a.player_name,
        avatarUrl: null,
        points: a.correct_answers,
        quizCount: 1,
        topStreak: a.correct_streak ?? 0,
        fastestMs: a.total_time_ms,
      }
    })

    let userEntry = null
    if (userId) {
      const userInRanked = withRanks.find(a => a.user_id === userId)
      if (userInRanked) {
        const profile = profileMap.get(userId)
        userEntry = {
          rank: userInRanked.rank,
          displayName: profile?.display_name ?? userInRanked.player_name,
          avatarUrl: null,
          points: userInRanked.correct_answers,
          quizCount: 1,
        }
      }
    }

    console.log(`[toppliste] ${period}/${scope} last_quiz ok ${Date.now() - t0}ms`)
    return NextResponse.json({ entries, userEntry, userIsPremium, quizTitle: latestQuiz.title, quizClosesAt: latestQuiz.closes_at })
  }

  // ── PERIOD MODE — sesong-poeng fra season_scores ──────────────────────────
  const periodStart = periodStartParam ?? getPeriodStart(period)
  const periodEnd   = periodEndParam ?? null   // null = ingen øvre grense

  // Nye Premium-moduser: ?page=N (paginering) og ?search= (navnesøk).
  // Fravær av begge = klassisk topp-10-visning (uendret for gratis-brukere).
  const pageParamRaw  = searchParams.get('page')
  const searchRaw     = (searchParams.get('search') ?? '').trim()
  const isPaginated   = pageParamRaw !== null || searchRaw !== ''
  const PAGE_SIZE     = isPaginated ? 20 : 10
  const page          = Math.max(1, parseInt(pageParamRaw ?? '1', 10) || 1)
  const search        = searchRaw === '' ? null : searchRaw
  const excludedIds   = [...excludedSet]

  type EntryOut = {
    rank: number; userId: string; displayName: string; avatarUrl: null
    points: number; quizCount: number; topStreak: number; fastestMs: number | null
  }
  type UserEntryOut = {
    rank: number; displayName: string; avatarUrl: null; points: number; quizCount: number
  }

  // Felles argumenter for RPC-funksjonene
  const rpcArgs = {
    p_scope: scope,
    p_scope_id: scopeId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_excluded_ids: excludedIds,
  }

  // Hjelper: tom respons (med "ventende quiz"-info i standardmodus)
  async function emptyResponse(uEntry: UserEntryOut | null, uRank: number | null) {
    let activeQuizClosesAt: string | null = null
    if (!isPaginated) {
      const { data: openQuiz } = await supabaseAdmin
        .from('quizzes')
        .select('closes_at')
        .eq('quiz_type', 'weekly')
        .gt('closes_at', new Date().toISOString())
        .order('closes_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      activeQuizClosesAt = openQuiz?.closes_at ?? null
    }
    console.log(`[toppliste] ${period}/${scope} empty ${Date.now() - t0}ms`)
    return NextResponse.json({
      entries: [], userEntry: uEntry, userIsPremium, quizTitle: null,
      activeQuizClosesAt, totalCount: 0, userRank: uRank, page, pageSize: PAGE_SIZE,
    })
  }

  // Hjelper: streak + raskeste tid for de listede brukerne (kun standardmodus,
  // brukes av flamme-/lyn-badge). Paginert/søk viser ingen badges.
  // orderedQuizIds = periodens quizer sortert eldst→nyest (kilde varierer per sti).
  async function enrich(listedIds: string[], orderedQuizIds: string[]): Promise<{ streak: Map<string, number>; fastest: Map<string, number> }> {
    const streak = new Map<string, number>()
    const fastest = new Map<string, number>()
    if (isPaginated || listedIds.length === 0 || orderedQuizIds.length === 0) return { streak, fastest }

    // Per-bruker deltagelse og raskeste tid — kjør parallelt (runder 5+6)
    let partQuery = supabaseAdmin
      .from('season_scores')
      .select('user_id, quiz_id')
      .eq('scope_type', scope)
      .in('user_id', listedIds)
      .gte('closes_at', periodStart)
    if (periodEnd) partQuery = partQuery.lt('closes_at', periodEnd)
    if (scopeId)   partQuery = partQuery.eq('scope_id', scopeId)
    else            partQuery = partQuery.is('scope_id', null)

    const [{ data: partRows }, { data: fastAttempts }] = await Promise.all([
      partQuery,
      supabaseAdmin
        .from('attempts')
        .select('user_id, total_time_ms')
        .in('user_id', listedIds)
        .in('quiz_id', orderedQuizIds)
        .eq('is_team', false)
        .not('user_id', 'is', null),
    ])

    const userQuizIds = new Map<string, Set<string>>()
    for (const r of (partRows ?? []) as { user_id: string; quiz_id: string }[]) {
      if (!userQuizIds.has(r.user_id)) userQuizIds.set(r.user_id, new Set())
      userQuizIds.get(r.user_id)!.add(r.quiz_id)
    }
    for (const uid of listedIds) {
      const played = userQuizIds.get(uid)
      let s = 0
      if (played) {
        for (let i = orderedQuizIds.length - 1; i >= 0; i--) {
          if (played.has(orderedQuizIds[i])) s++
          else break
        }
      }
      streak.set(uid, s)
    }

    for (const a of (fastAttempts ?? []) as { user_id: string; total_time_ms: number }[]) {
      const cur = fastest.get(a.user_id)
      if (cur === undefined || a.total_time_ms < cur) fastest.set(a.user_id, a.total_time_ms)
    }
    return { streak, fastest }
  }

  // Periodens quiz-tidslinje via RPC (kun nødvendig i standardmodus, RPC-sti)
  async function periodQuizTimelineViaRpc(): Promise<string[]> {
    if (isPaginated) return []
    const { data: pq } = await supabaseAdmin.rpc('season_leaderboard_period_quizzes', rpcArgs)
    return ((pq ?? []) as { quiz_id: string; closes_at: string }[])
      .sort((a, b) => a.closes_at.localeCompare(b.closes_at))
      .map(r => r.quiz_id)
  }

  // ── Forsøk SQL-basert rangering via RPC (rask sti). Faller automatisk
  //    tilbake til JS-aggregering hvis funksjonen ikke er deployet enda. ──────
  type RankedRow = {
    user_id: string; display_name: string | null
    points: number; quiz_count: number; rank: number; total_count: number
  }

  const { data: rankedData, error: rankedError } = await supabaseAdmin.rpc('season_leaderboard_ranked', {
    ...rpcArgs, p_page: page, p_page_size: PAGE_SIZE, p_search: search,
  })

  if (!rankedError) {
    // ── RPC-STI ──────────────────────────────────────────────────────────────
    const rankedRows = (rankedData ?? []) as RankedRow[]
    const totalCount = Number(rankedRows[0]?.total_count ?? 0)
    const listedIds  = rankedRows.map(r => r.user_id)

    // Runde 3 + 4 parallelt: bruker-stats/profil OG quiz-tidslinje
    const userStatsPromise = userId
      ? Promise.all([
          supabaseAdmin.rpc('season_leaderboard_user_stats', { ...rpcArgs, p_user_id: userId }),
          supabaseAdmin.from('profiles').select('display_name, premium_status').eq('id', userId).maybeSingle(),
        ])
      : Promise.resolve(null)

    const [userResult, orderedQuizIds] = await Promise.all([
      userStatsPromise,
      periodQuizTimelineViaRpc(),
    ])

    // Pakk ut bruker-resultater
    let userRank: number | null = null
    let userStats: { points: number; quizCount: number } | null = null
    let userDisplayName: string | null = null
    if (userResult) {
      const [{ data: us }, { data: prof }] = userResult
      const row = (us ?? [])[0] as { points: number; quiz_count: number; rank: number } | undefined
      if (row) { userRank = Number(row.rank); userStats = { points: Number(row.points), quizCount: Number(row.quiz_count) } }
      userIsPremium   = prof?.premium_status === true
      userDisplayName = prof?.display_name ?? null
    }

    const userEntry: UserEntryOut | null = (userId && userRank != null && userStats)
      ? { rank: userRank, displayName: userDisplayName ?? 'Spiller', avatarUrl: null, points: userStats.points, quizCount: userStats.quizCount }
      : null

    if (rankedRows.length === 0) return emptyResponse(userEntry, userRank)

    // Runde 5+6 er nå parallellisert inne i enrich()
    const { streak, fastest } = await enrich(listedIds, orderedQuizIds)

    const entries: EntryOut[] = rankedRows.map(r => ({
      rank: Number(r.rank),
      userId: r.user_id,
      displayName: r.display_name ?? 'Spiller',
      avatarUrl: null,
      points: Number(r.points),
      quizCount: Number(r.quiz_count),
      topStreak: streak.get(r.user_id) ?? 0,
      fastestMs: fastest.get(r.user_id) ?? null,
    }))

    console.log(`[toppliste] ${period}/${scope} rpc ok ${Date.now() - t0}ms`)
    return NextResponse.json({
      entries, userEntry, userIsPremium, quizTitle: null,
      totalCount, userRank, page, pageSize: PAGE_SIZE,
    })
  }

  // ── JS-FALLBACK (pre-migrasjon) ────────────────────────────────────────────
  // Henter alle rader og aggregerer i JS. Kjent teknisk gjeld, men kun aktiv
  // inntil RPC-migrasjonen (20260614000014) er kjørt.
  console.warn('[toppliste] RPC season_leaderboard_ranked utilgjengelig, bruker JS-fallback:', rankedError?.message)

  type ScoreRow = { user_id: string; points: number; quiz_id: string; closes_at: string }
  let scoresQuery = supabaseAdmin
    .from('season_scores')
    .select('user_id, points, quiz_id, closes_at')
    .eq('scope_type', scope)
    .gte('closes_at', periodStart)
  if (periodEnd) scoresQuery = scoresQuery.lt('closes_at', periodEnd)
  if (scopeId)   scoresQuery = scoresQuery.eq('scope_id', scopeId)
  else            scoresQuery = scoresQuery.is('scope_id', null)
  const { data: scores } = await scoresQuery

  // Aggregér per bruker
  const agg = new Map<string, { userId: string; points: number; quizCount: number }>()
  for (const row of (scores ?? []) as ScoreRow[]) {
    if (excludedSet.has(row.user_id)) continue
    if (!agg.has(row.user_id)) agg.set(row.user_id, { userId: row.user_id, points: 0, quizCount: 0 })
    const a = agg.get(row.user_id)!
    a.points += row.points
    a.quizCount += 1
  }

  // Sorter (samme ordning som RPC: poeng DESC, quizCount ASC, userId ASC)
  const sorted = [...agg.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (a.quizCount !== b.quizCount) return a.quizCount - b.quizCount
    return a.userId.localeCompare(b.userId)
  })

  // Profilnavn for alle rangerte (nødvendig for søk + visning). Liten skala i fallback.
  const allIds = sorted.map(s => s.userId)
  const nameMap = new Map<string, string | null>()
  if (allIds.length > 0) {
    const { data: profs } = await supabaseAdmin.from('profiles').select('id, display_name, premium_status').in('id', allIds)
    for (const p of (profs ?? []) as { id: string; display_name: string | null; premium_status: boolean | null }[]) {
      nameMap.set(p.id, p.display_name)
      if (p.id === userId) userIsPremium = p.premium_status === true
    }
  }
  // Premium kan også gjelde en bruker uten season_scores ennå
  if (userId && !nameMap.has(userId)) {
    const { data: prof } = await supabaseAdmin.from('profiles').select('display_name, premium_status').eq('id', userId).maybeSingle()
    if (prof) { userIsPremium = prof.premium_status === true; nameMap.set(userId, prof.display_name) }
  }

  // Rangert liste med plassering = indeks+1
  const rankedAll = sorted.map((s, i) => ({ ...s, rank: i + 1, displayName: nameMap.get(s.userId) ?? 'Spiller' }))
  const userRankIdx = userId ? rankedAll.findIndex(r => r.userId === userId) : -1
  const userRank = userRankIdx >= 0 ? userRankIdx + 1 : null
  const userEntry: UserEntryOut | null = userRankIdx >= 0
    ? { rank: userRank!, displayName: rankedAll[userRankIdx].displayName, avatarUrl: null, points: rankedAll[userRankIdx].points, quizCount: rankedAll[userRankIdx].quizCount }
    : null

  // Filtrer (søk) + paginer
  const filtered = search ? rankedAll.filter(r => r.displayName.toLowerCase().includes(search.toLowerCase())) : rankedAll
  const totalCount = filtered.length
  const pageSlice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (pageSlice.length === 0) return emptyResponse(userEntry, userRank)

  // Tidslinje fra de allerede hentede radene (RPC utilgjengelig i fallback)
  const timelineMap = new Map<string, string>()
  for (const row of (scores ?? []) as ScoreRow[]) timelineMap.set(row.quiz_id, row.closes_at)
  const fallbackOrderedQuizIds = [...timelineMap.keys()].sort(
    (a, b) => timelineMap.get(a)!.localeCompare(timelineMap.get(b)!)
  )
  const { streak, fastest } = await enrich(pageSlice.map(r => r.userId), fallbackOrderedQuizIds)
  const entries: EntryOut[] = pageSlice.map(r => ({
    rank: r.rank,
    userId: r.userId,
    displayName: r.displayName,
    avatarUrl: null,
    points: r.points,
    quizCount: r.quizCount,
    topStreak: streak.get(r.userId) ?? 0,
    fastestMs: fastest.get(r.userId) ?? null,
  }))

  console.log(`[toppliste] ${period}/${scope} js-fallback ok ${Date.now() - t0}ms`)
  return NextResponse.json({
    entries, userEntry, userIsPremium, quizTitle: null,
    totalCount, userRank, page, pageSize: PAGE_SIZE,
  })
}
