import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankQuizAttempts, type RankableAttempt } from '@/lib/ranking'
import { TOPPLISTE_PAGE_SIZE } from '@/lib/leaderboard-page-size'
import { getGloballyBlockedSet } from '@/lib/globally-blocked-set'
import { fetchAllRows } from '@/lib/paginate'

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

  // Paginert via fetchAllRows (18. august 2026): PostgREST kutter stille ved
  // 1000 rader (db-max-rows), og det gamle .limit(5000) gjorde ingenting.
  // Dedup/rangering nedstrøms (rankQuizAttempts) er rekkefølgeuavhengig gitt
  // at ALLE radene er der — .order('id') er kun for stabile pagineringsvinduer.
  let rows: LastQuizRow[]
  try {
    rows = await fetchAllRows<LastQuizRow>((from, to) =>
      supabaseAdmin
        .from('attempts')
        .select('id, user_id, player_name, correct_answers, total_time_ms, correct_streak, submitted_at')
        .eq('quiz_id', quizId)
        .not('user_id', 'is', null)
        .eq('is_team', false)
        .order('id')
        .range(from, to)
    )
  } catch (err) {
    // Samme synlige oppførsel som før pagineringen: en transient feil gir tom
    // liste for DENNE forespørselen — men caches IKKE (returen under skjer før
    // cache-skrivingen), så feilen varer aldri 30 s etter at basen er frisk.
    // Nå med loggspor, og aldri et DELVIS felt: feiler en senere side,
    // forkastes alt i stedet for å gjenskape den stille avkuttingen.
    console.error('[toppliste] last_quiz attempts-oppslag feilet:', err)
    return []
  }
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

// getGloballyBlockedSet er flyttet til lib/globally-blocked-set.ts (4. august
// 2026) og deles nå med /api/leaderboard/[id] og prev-rank — den enkelte
// quizens resultatliste gates på samme signal som denne fanen. Semantikk,
// cache-nøkkel (quiz-id) og TTL er uendret; se lib-filen for hele resonnementet
// («historikken står som den var», fail-open ved lesefeil).

// ── Live blokkert-status for ÉN bruker (periode-fanene, 5. august 2026) ──────
// Periode-visningene leser season_scores, og en blokkert bruker har ingen
// global-rader der — det finnes altså ikke noe felt å falle tilbake til slik
// last_quiz-grenen gjør. Men klienten trenger å vite AT kalleren står utenfor,
// ellers viser den «Du har ikke spilt ennå denne måneden» til en som spilte
// (samme feilklasse som «Reaktiver Premium»). Nåværende status er riktig
// signal her: det er dagens blokkering som avgjør om nye poeng uteblir.
// Kalles kun når userEntry er null (blokkerte flest), én indeksert
// enkeltbruker-spørring + evt. ett org-oppslag. Fail-open: en lesefeil skal
// aldri stemple noen som blokkert.
async function isUserGloballyBlockedLive(userId: string): Promise<boolean> {
  const { data: mems } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, global_league_opt_out')
    .eq('user_id', userId)
  if (!mems || mems.length === 0) return false
  const typed = mems as { organization_id: string; global_league_opt_out: boolean | null }[]
  if (typed.some(m => m.global_league_opt_out === true)) return true
  const orgIds = [...new Set(typed.map(m => m.organization_id))]
  const { data: restricted } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .in('id', orgIds)
    .eq('allow_global_league', false)
  return ((restricted ?? []) as { id: string }[]).length > 0
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

// 15 = klassen for rene DB-lesere. Sto midlertidig på 30 under Sak B
// (rapportert 12 s lasting, aldri reprodusert) — lukket 16. august 2026
// etter kartlegging i ro: ingen hale funnet.
export const maxDuration = 15

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

  // ── Scope-gate (6. august 2026) ─────────────────────────────────────────────
  // Samme gating som /api/leagues/[id]/leaderboard og /api/org/[slug]/dashboard:
  // org-/liga-topplister er interne rom, men denne ruten serverte de samme
  // navngitte medlemmene (displayName, poeng, userId) anonymt — målt mot prod
  // 6. august. Nøklet på VERDIEN scope !== 'global', ikke på om parameteren
  // finnes: SeasonLeaderboard sender alltid scope=global eksplisitt for den
  // offentlige topplisten, og den skal være bevislig uendret.
  if (scope !== 'global') {
    if ((scope !== 'league' && scope !== 'organization') || !scopeId) {
      return NextResponse.json({ error: 'Ugyldig scope' }, { status: 400 })
    }
    if (!userId) {
      return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
    }
    // Fersk maybeSingle, IKKE via getMemberSet-cachen: en nettopp fjernet
    // ansatt skal ikke ha 30 s etterslep på selve gaten. Identisk 403 enten
    // org/ligaen ikke finnes eller kalleren ikke er medlem — svaret skal ikke
    // røpe at rommet eksisterer.
    const { data: membership, error: memberError } = scope === 'league'
      ? await supabaseAdmin.from('league_members').select('user_id')
          .eq('league_id', scopeId).eq('user_id', userId).maybeSingle()
      : await supabaseAdmin.from('organization_members').select('user_id')
          .eq('organization_id', scopeId).eq('user_id', userId).maybeSingle()
    // Fail-safe: kan medlemskap ikke avgjøres, avvis. Prisen er en midlertidig
    // utilgjengelig org-/liga-toppliste som retter seg selv — alternativet er
    // en lekkasje som ikke kan angres.
    if (memberError) {
      return NextResponse.json({ error: 'Kunne ikke bekrefte tilgang' }, { status: 503 })
    }
    if (!membership) {
      return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })
    }
  }

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

    // ── Egne tall skjules aldri for en selv (5. august 2026) ──────────────────
    // En BLOKKERT kaller finnes ikke i withRanks (det filtrerte feltet) og
    // fikk fram til nå userEntry: null — klienten viste da «Du spilte ikke
    // ukens quiz.» til en som faktisk spilte. Samme prinsipp som
    // /api/leaderboard/[id] sin mine-fallback: raden hentes fra det
    // UFILTRERTE feltet (uten blocked-gaten, fortsatt uten excluded/
    // suspenderte). Ranken derfra er mot hele feltet og tegnes ikke av
    // klienten (userBlockedFromGlobal gater plasseringsraden, se
    // lib/season-period-table.ts) — raden bærer «har spilt» og egne tall.
    //
    // globallyBlockedSet.has(userId) forutsetter at kalleren HAR et forsøk på
    // quizen (settet utledes av attemptUserIds). Flagget settes kun når den
    // LEVERTE raden faktisk finnes i det ufiltrerte feltet — et startet-men-
    // ulevert forsøk skal fortsatt gi «Du spilte ikke …», som da er sant.
    // Invariant for klienten: på Siste quiz medfører userBlockedFromGlobal
    // alltid en userEntry.
    let userBlockedFromGlobal = false
    if (userId && !userEntry && globallyBlockedSet.has(userId)) {
      const unfilteredRows = (rawAttempts as Array<RankableAttempt & { user_id: string }>)
        .filter(a => !excludedSet.has(a.user_id))
      const mine = rankQuizAttempts(unfilteredRows, { includeGuests: false, requireSubmitted: true })
        .find(a => a.user_id === userId)
      if (mine) {
        userBlockedFromGlobal = true
        const profile = profileMap.get(userId)
        userEntry = {
          rank: mine.rank,
          displayName: profile?.display_name ?? mine.player_name,
          nickname: profile?.nickname ?? null,
          avatarUrl: null,
          points: mine.correct_answers,
          quizCount: 1,
          fastestMs: mine.total_time_ms,
        }
      }
    }

    console.log(`[toppliste] ${period}/${scope} last_quiz ok ${Date.now() - t0}ms`)
    return NextResponse.json({ entries, userEntry, userIsPremium, userBlockedFromGlobal, quizTitle: latestQuiz.title, quizClosesAt: latestQuiz.closes_at, totalCount, page, pageSize: TOPPLISTE_PAGE_SIZE })
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
  async function emptyResponse(uEntry: UserEntryOut | null, uRank: number | null, total = 0, uBlocked = false) {
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
      entries: [], userEntry: uEntry, userIsPremium, userBlockedFromGlobal: uBlocked, quizTitle: null,
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

    // Blokkert fra den åpne topplisten? Kun global-scope, kun når kalleren
    // mangler rader i perioden — se isUserGloballyBlockedLive. Uten dette
    // viste klienten «Du har ikke spilt ennå denne måneden» til en blokkert
    // som spilte (poengene skrives aldri globalt for dem).
    const userBlockedFromGlobal =
      scope === 'global' && userId && !userEntry
        ? await isUserGloballyBlockedLive(userId)
        : false

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
      return emptyResponse(userEntry, userRank, realTotal, userBlockedFromGlobal)
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
      entries, userEntry, userIsPremium, userBlockedFromGlobal, quizTitle: null,
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

  // Samme blokkert-signal som RPC-stien — se kommentaren der.
  const userBlockedFromGlobal =
    scope === 'global' && userId && !userEntry
      ? await isUserGloballyBlockedLive(userId)
      : false

  // Filtrer (søk) + paginer
  const filtered = search ? rankedAll.filter(r => r.displayName.toLowerCase().includes(search.toLowerCase())) : rankedAll
  const totalCount = filtered.length
  const pageSlice = filtered.slice((page - 1) * TOPPLISTE_PAGE_SIZE, page * TOPPLISTE_PAGE_SIZE)

  // Her er totaltallet allerede kjent (hele lista ligger i minnet), så det
  // sendes rett videre — ingen ekstra spørring nødvendig som i RPC-stien.
  if (pageSlice.length === 0) return emptyResponse(userEntry, userRank, totalCount, userBlockedFromGlobal)

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
    entries, userEntry, userIsPremium, userBlockedFromGlobal, quizTitle: null,
    totalCount, userRank, page, pageSize: TOPPLISTE_PAGE_SIZE,
  })
}
