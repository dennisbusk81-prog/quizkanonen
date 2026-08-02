import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankQuizAttempts, type RankableAttempt } from '@/lib/ranking'
import { fetchAllRows } from '@/lib/paginate'
import { TOPPLISTE_PAGE_SIZE } from '@/lib/leaderboard-page-size'
import {
  deriveBlockedFromScores,
  deriveBlockedFromLiveStatus,
  type OrgMembership,
} from '@/lib/global-league-visibility'

// last_quiz bruker den delte rangerings-helperen (lib/ranking) — samme #1 som
// Topp 3 og quiz-leaderboard. Toppliste ekskluderer gjester (includeGuests:false).

// ── Korttids-cache for last_quiz-attempts (Del 1 — Disk IO) ──────────────────
// «Siste quiz»-fanen hamres rett etter at en quiz stenger. Attemptene for en
// STENGT quiz er statiske, så vi cacher de råe attemptene per quiz-id i minne
// (samme getOrBuild-med-TTL-mønster som lib/ranking-snapshot, men per-instans i
// minne — jf. modul-nivå Map i lib/rate-limit.ts). All filtrering/rangering/
// output nedstrøms er 100 % uendret; kun DB-lesen spares på cache-treff.
type LastQuizRow = {
  id: string
  user_id: string
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
  submitted_at: string | null
}
// OM INVALIDERING (vurdert 28. juli 2026, ikke en glemt TODO): denne cachen
// (og memberSetCache under) er en modul-lokal Map per serverless-instans.
// `revalidateTag` når den IKKE — det mønsteret virker kun mot
// unstable_cache/data-cachen (slik correct-answer purger 'home-shared-data').
// Å invalidere på tvers av instanser krever delt lagring (Redis e.l.), og å
// konvertere til unstable_cache ville endret ytelsesprofilen på en sti som
// nettopp er tunet for fredagstrafikken. En fasitretting eller
// medlemskapsendring kan derfor gi opptil 30 s utdatert visning her — begge er
// sjeldne admin-handlinger, og selvkorrigerende innen TTL-en. Bevisst
// akseptert; ikke re-flagg uten at premissene har endret seg.
const LAST_QUIZ_CACHE_TTL_MS = 30_000
const lastQuizAttemptsCache = new Map<string, { rows: LastQuizRow[]; expires: number }>()

async function getLastQuizAttempts(quizId: string): Promise<LastQuizRow[]> {
  const now = Date.now()
  const cached = lastQuizAttemptsCache.get(quizId)
  if (cached && cached.expires > now) return cached.rows

  // OBS: PostgREST kutter stille ved 1000 rader (db-max-rows) — det gamle
  // .limit(5000) gjorde ingenting. Spørringen er IKKE beskyttet mot vekst:
  // over 1000 attempts på én quiz blir topplisten feil.
  // TODO(paginering): bruk fetchAllRows fra lib/paginate.ts.
  const { data, error } = await supabaseAdmin
    .from('attempts')
    .select('id, user_id, player_name, correct_answers, total_time_ms, correct_streak, submitted_at')
    .eq('quiz_id', quizId)
    .not('user_id', 'is', null)
    .eq('is_team', false)

  // Cach IKKE en feilrespons — unngår å servere tomt i 30s ved en transient feil.
  if (error || !data) return []

  const rows = data as LastQuizRow[]
  // Enkel opprydding så Map-en ikke vokser ubegrenset (utløpte quiz-nøkler).
  if (lastQuizAttemptsCache.size > 50) {
    for (const [k, v] of lastQuizAttemptsCache) if (v.expires <= now) lastQuizAttemptsCache.delete(k)
  }
  lastQuizAttemptsCache.set(quizId, { rows, expires: now + LAST_QUIZ_CACHE_TTL_MS })
  return rows
}

// ── Korttids-cache for liga/org-medlemskap og global-liga-restriksjoner ─────
// Samme rotårsak som attempts-cachen over: liga-/org-medlemskap endres kun
// ved en admin-handling, ikke per sidelast, men ble tidligere spurt ferskt
// på hver eneste last_quiz-forespørsel. Samme TTL/mønster, gjenbrukt her.
const memberSetCache = new Map<string, { ids: Set<string>; expires: number }>()

async function getMemberSet(scope: 'league' | 'organization', scopeId: string): Promise<Set<string>> {
  const key = `${scope}:${scopeId}`
  const now = Date.now()
  const cached = memberSetCache.get(key)
  if (cached && cached.expires > now) return cached.ids

  const { data } = scope === 'league'
    ? await supabaseAdmin.from('league_members').select('user_id').eq('league_id', scopeId)
    : await supabaseAdmin.from('organization_members').select('user_id').eq('organization_id', scopeId)
  const ids = new Set((data ?? []).map((m: { user_id: string }) => m.user_id))

  if (memberSetCache.size > 100) {
    for (const [k, v] of memberSetCache) if (v.expires <= now) memberSetCache.delete(k)
  }
  memberSetCache.set(key, { ids, expires: now + LAST_QUIZ_CACHE_TTL_MS })
  return ids
}

// Nøkkel = quiz-id, ikke bruker-settet — attemptUserIds er selv utledet fra
// den 30s-cachede attempts-listen over, så den er stabil innenfor samme
// cache-vindu og trenger ikke være del av nøkkelen.
const globallyBlockedSetCache = new Map<string, { ids: Set<string>; expires: number }>()

/**
 * Hvilke brukere som IKKE skal vises på den globale «Siste quiz»-fanen.
 *
 * HISTORIKKEN STÅR SOM DEN VAR. Periodevisningene (måned/kvartal/år/all-time)
 * leser season_scores og filtrerer aldri på dagens opt-out-status — en bruker
 * som meldte seg ut ETTER en quiz beholder plasseringen sin i den quizen.
 * Denne fanen leste tidligere organization_members LIVE og gjenbrukte dagens
 * status på en historisk quiz, slik at en utmelding med tilbakevirkende kraft
 * fjernet brukeren fra en quiz hen lovlig deltok i. Det var den eneste
 * visningen i toppliste-ruten som oppførte seg slik.
 *
 * Kilden til «som det var» finnes allerede: award-season-points skriver KUN
 * global-rader for brukere som ikke var blokkert på skrivetidspunktet
 * (lib/award-season-points.ts — `.filter(({ userId }) => !globallyBlockedUserIds.has(userId))`).
 * For en ferdigbehandlet quiz er derfor «har attempt, men ingen global
 * season_scores-rad» nøyaktig lik «var blokkert da quizen ble gjort opp».
 * Begge sidene starter fra samme attempts-populasjon (is_team=false,
 * user_id not null) — award filtrerer ikke på submitted_at, så et ulevert
 * forsøk kan ikke gi et falskt «blokkert».
 *
 * Er quizen IKKE gjort opp ennå (season_points_awarded=false — den er fortsatt
 * åpen, eller cronen har ikke rukket den), finnes ingen historisk fasit. Da er
 * dagens status per definisjon også datidens, og vi faller tilbake til det
 * live oppslaget. Ingen tilbakevirkende kraft er mulig i det vinduet.
 */
async function getGloballyBlockedSet(
  quizId: string,
  attemptUserIds: string[],
  seasonPointsAwarded: boolean
): Promise<Set<string>> {
  const now = Date.now()
  const cached = globallyBlockedSetCache.get(quizId)
  if (cached && cached.expires > now) return cached.ids

  const blocked = new Set<string>()

  if (seasonPointsAwarded) {
    // Historisk fasit: hvem fikk faktisk en global-rad for denne quizen.
    // Paginert — season_scores kan passere 1000 rader for én quiz, og
    // PostgREST kutter da stille (se lib/paginate.ts). Filtrerer på quiz_id
    // framfor .in('user_id', …) slik at URL-lengdegrensen ved ~390 id-er
    // aldri blir relevant.
    let scored: { user_id: string }[]
    try {
      scored = await fetchAllRows<{ user_id: string }>((from, to) =>
        supabaseAdmin
          .from('season_scores')
          .select('user_id')
          .eq('quiz_id', quizId)
          .eq('scope_type', 'global')
          .is('scope_id', null)
          .order('user_id', { ascending: true })
          .range(from, to)
      )
    } catch {
      // Cach ikke ved feil — returner tomt (ingen blokkering) framfor å
      // skjule spillere på feil grunnlag i 30 sekunder.
      return blocked
    }
    for (const uid of deriveBlockedFromScores(attemptUserIds, scored.map(r => r.user_id))) {
      blocked.add(uid)
    }
  } else if (attemptUserIds.length > 0) {
    // Quizen er ikke gjort opp ennå — dagens status ER datidens status.
    const { data: orgMems } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, organization_id, global_league_opt_out')
      .in('user_id', attemptUserIds)
    if (orgMems && orgMems.length > 0) {
      const mems = orgMems as OrgMembership[]
      const orgIds = [...new Set(mems.map(m => m.organization_id))]
      const { data: restrictedOrgs } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .in('id', orgIds)
        .eq('allow_global_league', false)
      const restrictedOrgIds = new Set(((restrictedOrgs ?? []) as { id: string }[]).map(o => o.id))
      for (const uid of deriveBlockedFromLiveStatus(mems, restrictedOrgIds)) {
        blocked.add(uid)
      }
    }
  }

  if (globallyBlockedSetCache.size > 50) {
    for (const [k, v] of globallyBlockedSetCache) if (v.expires <= now) globallyBlockedSetCache.delete(k)
  }
  globallyBlockedSetCache.set(quizId, { ids: blocked, expires: now + LAST_QUIZ_CACHE_TTL_MS })
  return blocked
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

  // Paginering og søk — beregnes før last_quiz slik at begge modiene kan bruke dem.
  // Sidestørrelsen er FAST (TOPPLISTE_PAGE_SIZE) i BEGGE moduser og uavhengig
  // av om `?page=` er satt — se lib/leaderboard-page-size.ts for hvorfor.
  // `isPaginated` betyr fortsatt «brukeren blar/søker», og styrer kun hvor mye
  // ekstraarbeid ruten gjør (badges via enrich(), quiz-tidslinje, oppslag av
  // ventende quiz) — den skal ALDRI påvirke sidestørrelsen igjen.
  const pageParamRaw  = searchParams.get('page')
  const searchRaw     = (searchParams.get('search') ?? '').trim()
  const isPaginated   = pageParamRaw !== null || searchRaw !== ''
  const page          = Math.max(1, parseInt(pageParamRaw ?? '1', 10) || 1)
  const search        = searchRaw === '' ? null : searchRaw
  const excludedIds   = [...excludedSet]

  // ── LAST QUIZ MODE ──────────────────────────────────────────────────────────
  if (period === 'last_quiz') {
    // Hent nyeste quiz som faktisk har minst én attempt (INNER JOIN).
    // Uten dette vil testquizer med closes_at i fremtiden og 0 attempts
    // skygge for quizer der folk faktisk har spilt.
    //
    // Del 4 (Disk IO): joinen brukes KUN som eksistensfilter, men hentet
    // tidligere ut hele attempts-arrayet for quizen — ucachet, på hver eneste
    // last_quiz-forespørsel, altså nøyaktig lesingen getLastQuizAttempts-cachen
    // skulle fjerne. limit(1) på den refererte tabellen gjør den til et rent
    // EXISTS-oppslag (én rad via idx_attempts_quiz_id). Filteret — og dermed
    // hvilken quiz som velges — er uendret.
    const { data: latestQuiz } = await supabaseAdmin
      .from('quizzes')
      .select('id, title, closes_at, season_points_awarded, attempts!inner(id)')
      .eq('quiz_type', 'weekly')
      .order('closes_at', { ascending: false })
      .limit(1, { referencedTable: 'attempts' })
      .limit(1)
      .maybeSingle()

    if (!latestQuiz) {
      return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: null })
    }

    // Del 1: cachet lesing (30s TTL per quiz-id). Identisk resultat som en
    // direkte spørring — kun færre DB-lesinger under samtidig last etter quiz.
    const rawAttempts = await getLastQuizAttempts(latestQuiz.id)

    if (rawAttempts.length === 0) {
      return NextResponse.json({ entries: [], userEntry: null, userIsPremium, quizTitle: latestQuiz.title })
    }

    // For league/org scopes: filter attempts to members only. 30s-cachet —
    // se getMemberSet over.
    let memberSet: Set<string> | null = null
    if (scope === 'league' && scopeId) {
      memberSet = await getMemberSet('league', scopeId)
    } else if (scope === 'organization' && scopeId) {
      memberSet = await getMemberSet('organization', scopeId)
    }

    // Global scope: ekskluder brukere som var blokkert fra global liga da denne
    // quizen ble gjort opp (org med allow_global_league=false, eller egen
    // global_league_opt_out). Leses fra season_scores når quizen er ferdig
    // behandlet, slik at en senere utmelding ikke omskriver historikken —
    // samme prinsipp som periodevisningene. 30s-cachet per quiz-id.
    const globallyBlockedSet = scope === 'global'
      ? await getGloballyBlockedSet(
          latestQuiz.id,
          [...new Set((rawAttempts as Array<{ user_id: string }>).map(a => a.user_id).filter(Boolean))],
          latestQuiz.season_points_awarded === true,
        )
      : new Set<string>()

    // Scope-/eksklusjons-filtrering før rangering (helperen kjenner ikke
    // excluded_members eller liga/org-medlemskap).
    const scopedRows = (rawAttempts as Array<RankableAttempt & { user_id: string }>).filter(a => {
      if (excludedSet.has(a.user_id)) return false
      if (memberSet && !memberSet.has(a.user_id)) return false
      if (globallyBlockedSet.has(a.user_id)) return false
      return true
    })

    // Delt helper: submitted-filter, dedup per user_id, 4-nøkkels tiebreak.
    // includeGuests:false — kun innloggede teller på sesong-toppliste.
    const withRanks = rankQuizAttempts(scopedRows, { includeGuests: false, requireSubmitted: true })

    // Søk på player_name (beste tilnærming uten full profilfetch)
    const filtered = search
      ? withRanks.filter(a => a.player_name.toLowerCase().includes(search.toLowerCase()))
      : withRanks
    const totalCount = filtered.length
    const pageSlice  = filtered.slice((page - 1) * TOPPLISTE_PAGE_SIZE, page * TOPPLISTE_PAGE_SIZE)

    // Hent profiler kun for siden + innlogget bruker
    const pageIds = pageSlice.map(a => a.user_id)
    const profileIdsSet = new Set(pageIds)
    if (userId) profileIdsSet.add(userId)
    const profileIds = [...profileIdsSet]

    const { data: profiles } = profileIds.length > 0
      ? await supabaseAdmin.from('profiles').select('id, display_name, nickname, premium_status').in('id', profileIds)
      : { data: [] }

    const profileMap = new Map<string, { display_name: string | null; nickname: string | null }>()
    for (const p of (profiles ?? []) as { id: string; display_name: string | null; nickname: string | null; premium_status: boolean | null }[]) {
      profileMap.set(p.id, p)
      if (p.id === userId) userIsPremium = p.premium_status === true
    }

    const entries = pageSlice.map(a => {
      const profile = profileMap.get(a.user_id)
      return {
        rank: a.rank,
        userId: a.user_id,
        displayName: profile?.display_name ?? a.player_name,
        nickname: profile?.nickname ?? null,
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
          nickname: profile?.nickname ?? null,
          avatarUrl: null,
          points: userInRanked.correct_answers,
          quizCount: 1,
          // Samme felt/verdi som entries-mappingen over bruker for andre
          // spillere (a.total_time_ms) — withRanks er allerede den fulle,
          // rangerte listen (ikke bare siden), så ingen ny spørring trengs.
          // Lagt til 28. juli 2026 slik at «Din plassering» kan vises som
          // tabellrad med korrekt Tid-kolonne også for Siste quiz.
          fastestMs: userInRanked.total_time_ms,
        }
      }
    }

    console.log(`[toppliste] ${period}/${scope} last_quiz ok ${Date.now() - t0}ms`)
    return NextResponse.json({ entries, userEntry, userIsPremium, quizTitle: latestQuiz.title, quizClosesAt: latestQuiz.closes_at, totalCount, page, pageSize: TOPPLISTE_PAGE_SIZE })
  }

  // ── PERIOD MODE — sesong-poeng fra season_scores ──────────────────────────
  const periodStart = periodStartParam ?? getPeriodStart(period)
  const periodEnd   = periodEndParam ?? null   // null = ingen øvre grense

  type EntryOut = {
    rank: number; userId: string; displayName: string; nickname: string | null; avatarUrl: null
    points: number; quizCount: number; topStreak: number; fastestMs: number | null
  }
  type UserEntryOut = {
    rank: number; displayName: string; nickname: string | null; avatarUrl: null; points: number; quizCount: number
  }

  // Felles argumenter for RPC-funksjonene
  const rpcArgs = {
    p_scope: scope,
    p_scope_id: scopeId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_excluded_ids: excludedIds,
  }

  // Hjelper: tom respons (med "ventende quiz"-info i standardmodus).
  //
  // `total` MÅ være det reelle antallet deltakere, ikke 0, når lista faktisk
  // har rader men den forespurte SIDEN er tom. Klienten regner totalPages ut
  // fra totalCount, og gatet sidenavigasjonen på `totalPages > 1` — en
  // hardkodet 0 her ga totalPages = 1 og fjernet dermed hele knapperaden, så
  // brukeren mistet veien tilbake til side 1 og måtte laste siden på nytt.
  async function emptyResponse(uEntry: UserEntryOut | null, uRank: number | null, total = 0) {
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
      activeQuizClosesAt, totalCount: total, userRank: uRank, page, pageSize: TOPPLISTE_PAGE_SIZE,
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
    // season_leaderboard_period_quizzes aksepterer kun 4 params — ikke p_excluded_ids
    const { data: pq } = await supabaseAdmin.rpc('season_leaderboard_period_quizzes', {
      p_scope:        rpcArgs.p_scope,
      p_scope_id:     rpcArgs.p_scope_id,
      p_period_start: rpcArgs.p_period_start,
      p_period_end:   rpcArgs.p_period_end,
    })
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
    ...rpcArgs, p_page: page, p_page_size: TOPPLISTE_PAGE_SIZE, p_search: search,
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
          supabaseAdmin.from('profiles').select('display_name, nickname, premium_status').eq('id', userId).maybeSingle(),
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
    let userNickname: string | null = null
    if (userResult) {
      const [{ data: us }, { data: prof }] = userResult
      const row = (us ?? [])[0] as { points: number; quiz_count: number; rank: number } | undefined
      if (row) { userRank = Number(row.rank); userStats = { points: Number(row.points), quizCount: Number(row.quiz_count) } }
      userIsPremium   = prof?.premium_status === true
      userDisplayName = prof?.display_name ?? null
      userNickname    = (prof as { nickname?: string | null } | null)?.nickname ?? null
    }

    const userEntry: UserEntryOut | null = (userId && userRank != null && userStats)
      ? { rank: userRank, displayName: userDisplayName ?? 'Spiller', nickname: userNickname, avatarUrl: null, points: userStats.points, quizCount: userStats.quizCount }
      : null

    if (rankedRows.length === 0) {
      // `total_count` leveres som en KOLONNE på hver rad, så en tom side gir
      // oss den ikke. Er vi forbi siste side (kun mulig via en foreldet/delt
      // ?page=, siden knappene nå bygges av samme faste sidestørrelse), hentes
      // det reelle totaltallet med ett ekstra kall mot side 1 — ellers ville
      // klienten fått totalCount: 0 og mistet hele sidenavigasjonen. Side 1
      // uten rader betyr at lista faktisk er tom; da er 0 riktig svar.
      let realTotal = 0
      if (page > 1) {
        const { data: firstPage } = await supabaseAdmin.rpc('season_leaderboard_ranked', {
          ...rpcArgs, p_page: 1, p_page_size: TOPPLISTE_PAGE_SIZE, p_search: search,
        })
        realTotal = Number(((firstPage ?? []) as RankedRow[])[0]?.total_count ?? 0)
      }
      return emptyResponse(userEntry, userRank, realTotal)
    }

    // Runde 5+6 er nå parallellisert inne i enrich()
    // RPC returnerer ikke nickname — hent kallenavn for de listede brukerne separat
    const nickMap = new Map<string, string | null>()
    if (listedIds.length > 0) {
      const { data: nickRows } = await supabaseAdmin
        .from('profiles')
        .select('id, nickname')
        .in('id', listedIds)
      for (const n of (nickRows ?? []) as { id: string; nickname: string | null }[]) {
        nickMap.set(n.id, n.nickname ?? null)
      }
    }

    const { streak, fastest } = await enrich(listedIds, orderedQuizIds)

    const entries: EntryOut[] = rankedRows.map(r => ({
      rank: Number(r.rank),
      userId: r.user_id,
      displayName: r.display_name ?? 'Spiller',
      nickname: nickMap.get(r.user_id) ?? null,
      avatarUrl: null,
      points: Number(r.points),
      quizCount: Number(r.quiz_count),
      topStreak: streak.get(r.user_id) ?? 0,
      fastestMs: fastest.get(r.user_id) ?? null,
    }))

    console.log(`[toppliste] ${period}/${scope} rpc ok ${Date.now() - t0}ms`)
    return NextResponse.json({
      entries, userEntry, userIsPremium, quizTitle: null,
      totalCount, userRank, page, pageSize: TOPPLISTE_PAGE_SIZE,
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
  const nickMap = new Map<string, string | null>()
  if (allIds.length > 0) {
    const { data: profs } = await supabaseAdmin.from('profiles').select('id, display_name, nickname, premium_status').in('id', allIds)
    for (const p of (profs ?? []) as { id: string; display_name: string | null; nickname: string | null; premium_status: boolean | null }[]) {
      nameMap.set(p.id, p.display_name)
      nickMap.set(p.id, p.nickname ?? null)
      if (p.id === userId) userIsPremium = p.premium_status === true
    }
  }
  // Premium kan også gjelde en bruker uten season_scores ennå
  if (userId && !nameMap.has(userId)) {
    const { data: prof } = await supabaseAdmin.from('profiles').select('display_name, nickname, premium_status').eq('id', userId).maybeSingle()
    if (prof) { userIsPremium = prof.premium_status === true; nameMap.set(userId, prof.display_name); nickMap.set(userId, (prof as { nickname?: string | null }).nickname ?? null) }
  }

  // Rangert liste med plassering = indeks+1
  const rankedAll = sorted.map((s, i) => ({ ...s, rank: i + 1, displayName: nameMap.get(s.userId) ?? 'Spiller', nickname: nickMap.get(s.userId) ?? null }))
  const userRankIdx = userId ? rankedAll.findIndex(r => r.userId === userId) : -1
  const userRank = userRankIdx >= 0 ? userRankIdx + 1 : null
  const userEntry: UserEntryOut | null = userRankIdx >= 0
    ? { rank: userRank!, displayName: rankedAll[userRankIdx].displayName, nickname: rankedAll[userRankIdx].nickname, avatarUrl: null, points: rankedAll[userRankIdx].points, quizCount: rankedAll[userRankIdx].quizCount }
    : null

  // Filtrer (søk) + paginer
  const filtered = search ? rankedAll.filter(r => r.displayName.toLowerCase().includes(search.toLowerCase())) : rankedAll
  const totalCount = filtered.length
  const pageSlice = filtered.slice((page - 1) * TOPPLISTE_PAGE_SIZE, page * TOPPLISTE_PAGE_SIZE)

  // Her er totaltallet allerede kjent (hele lista ligger i minnet), så det
  // sendes rett videre — ingen ekstra spørring nødvendig som i RPC-stien.
  if (pageSlice.length === 0) return emptyResponse(userEntry, userRank, totalCount)

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
    nickname: r.nickname,
    avatarUrl: null,
    points: r.points,
    quizCount: r.quizCount,
    topStreak: streak.get(r.userId) ?? 0,
    fastestMs: fastest.get(r.userId) ?? null,
  }))

  console.log(`[toppliste] ${period}/${scope} js-fallback ok ${Date.now() - t0}ms`)
  return NextResponse.json({
    entries, userEntry, userIsPremium, quizTitle: null,
    totalCount, userRank, page, pageSize: TOPPLISTE_PAGE_SIZE,
  })
}
