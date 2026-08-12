'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import SkeletonCard from '@/components/SkeletonCard'
import { getAvatarInitial } from '@/lib/avatar-initial'
import BadgeCircle, { type BadgeKind } from '@/components/BadgeCircle'
import ResultsTable, { type ResultsTableRow } from '@/components/ResultsTable'
import { computeDuelAffordance } from '@/lib/duel-affordance'
import DuelChallengeModal from '@/components/DuelChallengeModal'
import { useProfile } from '@/components/ProfileProvider'
import { formatQuizCount, shouldShowPlacementRow, buildPlacementRow } from '@/lib/season-period-table'
import { TOPPLISTE_PAGE_SIZE } from '@/lib/leaderboard-page-size'
import { decidePlacementDisplay, globalExclusionReason } from '@/lib/placement-visibility'
import { withTimeout } from '@/lib/with-timeout'
import { decideSessionCheck } from '@/lib/session-check'

// Sikkerhetsventil mot auth-lås-konflikt i getSession() — samme verdi og samme
// begrunnelse som AuthListener.tsx: oppslaget leser normalt cookie/localStorage
// på under 100 ms, så dette er aldri normal last, kun en øvre grense.
const SESSION_CHECK_MS = 1500

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const EXTRA_STYLES = `
  .tp-tab-row::-webkit-scrollbar { display: none; }
  .tp-tab-row { scrollbar-width: none; -ms-overflow-style: none; }
  .tp-accordion-wrap {
    border: 1px solid #2a2d38;
    border-radius: 16px;
    overflow: hidden;
    transition: border-color 150ms ease;
  }
  .tp-accordion-wrap:hover { border-color: #c9a84c; }
  .tp-accordion-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 18px;
    cursor: pointer;
    background: #21242e;
    border: none;
    width: 100%;
    text-align: left;
    font-family: 'Instrument Sans', sans-serif;
    transition: background 150ms ease;
  }
  .tp-accordion-btn:hover { background: #262930; }
`

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'last_quiz' | 'month' | 'quarter' | 'year' | 'alltime'

function isPeriod(v: string | null): v is Period {
  return v === 'last_quiz' || v === 'month' || v === 'quarter' || v === 'year' || v === 'alltime'
}

type Entry = {
  rank: number
  userId: string
  displayName: string
  nickname?: string | null
  avatarUrl: string | null
  points: number
  quizCount: number
  topStreak: number
  fastestMs: number | null
}

type UserEntry = {
  rank: number
  displayName: string
  nickname?: string | null
  avatarUrl: string | null
  points: number
  quizCount: number
  /** Kun satt for Siste quiz (fra 28. juli 2026) — periode-visninger har ikke tid-begrep. */
  fastestMs?: number | null
}

type ApiResponse = {
  entries: Entry[]
  userEntry: UserEntry | null
  userIsPremium: boolean
  // Kalleren er blokkert fra den åpne topplisten (stengt org / eget opt-out).
  // På Siste quiz medfører flagget alltid en userEntry (kalleren leverte —
  // raden er «egne tall» fra det ufiltrerte feltet, se /api/toppliste); i
  // periode-fanene betyr det «poengene dine føres ikke her». Kun global-scope.
  userBlockedFromGlobal?: boolean
  quizTitle?: string | null
  quizClosesAt?: string | null
  activeQuizClosesAt?: string | null
  totalCount?: number
  userRank?: number | null
  page?: number
  pageSize?: number
}

// Sidestørrelsen kommer fra den delte konstanten, ikke et eget tall her — det
// var nettopp to divergerende tall som gjorde at knappen «21–30» hentet rad
// 41–60. `data.pageSize` fra API-et vinner fortsatt når svaret har landet;
// konstanten er fallback før første svar, og er nå per definisjon lik den
// serveren regner med. Se lib/leaderboard-page-size.ts.
const PAGE_SIZE = TOPPLISTE_PAGE_SIZE

type HistoryWinner = {
  displayName: string
  nickname?: string | null
  avatarUrl: string | null
  score: number
  scoreLabel: string
}

type HistoryEntry = {
  key: string
  label: string
  closesAt: string
  quizId?: string
  winner: HistoryWinner | null
}

type ExpandedEntry = {
  rank: number
  userId: string
  displayName: string
  nickname?: string | null
  avatarUrl: string | null
  points: number
  quizCount: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  last_quiz: 'Siste quiz',
  month:     'Måned',
  quarter:   'Kvartal',
  year:      'År',
  alltime:   'All-time',
}

const HISTORY_TITLE: Record<Exclude<Period, 'alltime'>, string> = {
  last_quiz: 'Tidligere quizer',
  month:     'Tidligere måneder',
  quarter:   'Tidligere kvartaler',
  year:      'Tidligere år',
}

const NB_MONTHS = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember']

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function getCountdown(period: Period): string | null {
  if (period === 'alltime' || period === 'last_quiz') return null
  const now = new Date()
  let end: Date
  if (period === 'month') {
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    end = new Date(now.getFullYear(), (q + 1) * 3, 0)
  } else {
    end = new Date(now.getFullYear(), 11, 31)
  }
  const days = Math.ceil((end.getTime() - now.getTime()) / 86400000)
  const label = period === 'month' ? 'måneden' : period === 'quarter' ? 'kvartalet' : 'året'
  return `${days} dager igjen av ${label}`
}

function formatHistoryLabel(key: string, period: Period): string {
  if (period === 'month') {
    const [year, month] = key.split('-').map(Number)
    return `${NB_MONTHS[month - 1]} ${year}`
  }
  if (period === 'quarter') {
    const [year, q] = key.split('-Q')
    return `K${q} ${year}`
  }
  return key
}

function getPeriodRange(key: string, period: 'month' | 'quarter' | 'year'): { start: string; end: string } {
  if (period === 'month') {
    const [year, month] = key.split('-').map(Number)
    return {
      start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
      end:   new Date(Date.UTC(year, month, 1)).toISOString(),
    }
  }
  if (period === 'quarter') {
    const [yearStr, qStr] = key.split('-Q')
    const year = parseInt(yearStr)
    const q = parseInt(qStr) - 1
    return {
      start: new Date(Date.UTC(year, q * 3, 1)).toISOString(),
      end:   new Date(Date.UTC(year, (q + 1) * 3, 1)).toISOString(),
    }
  }
  const year = parseInt(key)
  return {
    start: new Date(Date.UTC(year, 0, 1)).toISOString(),
    end:   new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
  }
}

function assignBadges(entries: Entry[]): Map<string, BadgeKind> {
  const badges = new Map<string, BadgeKind>()
  if (entries[0]) badges.set(entries[0].userId, 'krone')
  let flamme: Entry | null = null
  for (const e of entries) {
    if (badges.has(e.userId)) continue
    if (e.topStreak >= 3 && (!flamme || e.topStreak > flamme.topStreak)) flamme = e
  }
  if (flamme) badges.set(flamme.userId, 'flamme')
  let lyn: Entry | null = null
  for (const e of entries) {
    if (badges.has(e.userId)) continue
    if (e.fastestMs !== null && (!lyn || e.fastestMs < lyn.fastestMs!)) lyn = e
  }
  if (lyn) badges.set(lyn.userId, 'lyn')
  for (const e of entries) {
    if (e.rank >= 2 && e.rank <= 3 && !badges.has(e.userId)) badges.set(e.userId, 'medalje')
  }
  return badges
}


// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#918f8a', fontStyle: 'italic' as const },
  spinWrap: { padding: '56px 0', textAlign: 'center' as const },

  tabRow:      { display: 'flex', borderBottom: '1px solid #2a2d38', marginBottom: 20, marginTop: 4, overflowX: 'auto' as const, msOverflowStyle: 'none' as const },
  tabActive:   { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid #c9a84c', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  tabInactive: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },

  countdown: { fontSize: 12, color: '#e8e4dd', textAlign: 'center' as const, marginBottom: 20, letterSpacing: '0.04em' },
  quizLabel: { fontSize: 12, color: '#e8e4dd', textAlign: 'center' as const, marginBottom: 20, letterSpacing: '0.02em' },

  name: { fontFamily: "'Libre Baskerville', serif", fontSize: 15, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, marginBottom: 2 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 10px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#918f8a', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },

  userCard: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px 24px', marginTop: 8 },

  ctaText:    { fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 14 },
  btnGold:    { display: 'inline-block', background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 24px', borderRadius: 10, textDecoration: 'none' },
  btnOutline: { display: 'inline-block', background: 'transparent', color: '#e8e4dd', border: '0.5px solid #2a2d38', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 600, padding: '10px 24px', borderRadius: 10, textDecoration: 'none' },

  legendRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13, color: '#e8e4dd' },

  empty:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 12 },
  emptyTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 8 },
  emptySub:   { fontSize: 13, color: '#e8e4dd', lineHeight: 1.6 },

  // Historikk-accordion
  histAccordion:   { marginTop: 20, overflow: 'hidden' as const },
  histHeaderTitle: { fontSize: 13, fontWeight: 600, color: '#e8e4dd' },
  histHeaderChev:  { fontSize: 11, color: '#c9a84c' },
  histBody:        { background: '#21242e', borderTop: '1px solid #2a2d38' },
  histEmpty:       { padding: '24px 18px', fontSize: 13, color: '#e8e4dd', textAlign: 'center' as const },

  histRow:         { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '0.5px solid #2a2d38', cursor: 'pointer' },
  histRowLast:     { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px' },
  histRowQuiz:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '0.5px solid #2a2d38' },
  histRowQuizLast: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px' },
  histPeriodLabel: { fontSize: 13, fontWeight: 600, color: '#ffffff', minWidth: 120, flexShrink: 0 },
  histWinner:      { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  histWinnerName:  { fontSize: 13, color: '#e8e4dd', overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const },
  histWinnerScore: { fontSize: 12, color: '#c9a84c', fontWeight: 600, flexShrink: 0 },
  histChevron:     { fontSize: 11, color: '#918f8a', flexShrink: 0, marginLeft: 8 },
  histAvatarSm:    { width: 24, height: 24, borderRadius: '50%', background: '#2a2d38', border: '1px solid rgba(201,168,76,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#c9a84c', flexShrink: 0, overflow: 'hidden' as const },

  expandedWrap:  { background: '#1a1c23', borderTop: '0.5px solid #2a2d38', padding: '12px 18px' },
  expandedRow:   { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '0.5px solid rgba(42,45,56,0.6)' },
  expandedRank:  { fontSize: 12, color: '#918f8a', width: 22, flexShrink: 0, textAlign: 'right' as const },
  expandedName:  { fontSize: 13, color: '#e8e4dd', flex: 1, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const },
  expandedScore: { fontSize: 13, fontWeight: 600, color: '#c9a84c', flexShrink: 0 },
  expandedSpin:  { padding: '12px 0', fontSize: 12, color: '#e8e4dd', textAlign: 'center' as const },
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  scope: 'global' | 'league' | 'organization'
  scopeId?: string | null
  loginHref?: string
  globalLeagueDisabled?: boolean
  /** Org-slug — settes kun i org-modus. Brukes til å org-scope quiz-toppliste-lenker. */
  orgSlug?: string
  /** Liga-slug — settes kun i liga-modus. Brukes til å liga-scope quiz-toppliste-lenker (parallelt med orgSlug). */
  leagueSlug?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SeasonLeaderboard({ scope, scopeId, loginHref = '/login?next=/toppliste', globalLeagueDisabled, orgSlug, leagueSlug }: Props) {
  const scopeInfix = scope === 'league' ? ' i ligaen' : scope === 'organization' ? ' i bedriften' : ''
  const notPlayedSuffix = scope !== 'global' ? ' Bli med de andre!' : ''

  const EMPTY_TEXT: Record<Period, { title: string; sub: string }> = {
    last_quiz: { title: 'Ingen avsluttede quizer ennå',                       sub: 'Kom tilbake etter at ukens quiz er stengt.' },
    month:     { title: `Ingen${scopeInfix} har spilt denne måneden ennå`,    sub: 'Spill en quiz for å komme på listen!' },
    quarter:   { title: `Ingen${scopeInfix} har spilt dette kvartalet ennå`,  sub: 'Spill en quiz for å komme på listen!' },
    year:      { title: `Ingen${scopeInfix} har spilt i år ennå`,             sub: 'Spill en quiz for å komme på listen!' },
    alltime:   { title: `Ingen${scopeInfix} har spilt ennå`,                  sub: 'Spill en quiz for å komme på listen!' },
  }

  const NOT_PLAYED_TEXT: Record<Period, string> = {
    last_quiz: 'Du spilte ikke ukens quiz.',
    month:     `Du har ikke spilt ennå denne måneden.${notPlayedSuffix}`,
    quarter:   `Du har ikke spilt ennå dette kvartalet.${notPlayedSuffix}`,
    year:      `Du har ikke spilt ennå i år.${notPlayedSuffix}`,
    alltime:   'Du har ikke spilt ennå.',
  }

  // period/histOpen/expandedKey er URL-styrt (query-parametrene period/hist/
  // histKey) i stedet for ren useState. Uten dette nullstilles hele
  // "Tidligere quizer"-historikken hver gang siden mountes på nytt, så en
  // bruker som gikk fra én historisk quiz til en annen måtte alltid innom
  // "Siste quiz" (default-mount-tilstanden) og åpne historikken manuelt på
  // nytt. Med URL-state kan lenken til en historisk quiz (se buildQuizHref
  // under) ta brukeren rett tilbake til samme åpne fane, og visningen blir
  // delbar/direktelastbar. Selve dataene (histData/expandedData) forblir
  // lokal cache — periode-spesifikk, nullstilles ved periodebytte.
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  // Kun til blokkert-kortet i global-scope: «Se topplisten hos {org}»-lenken og
  // årsaksteksten. Ren context-lesing — ProfileProvider henter uansett, ingen
  // nye kall herfra.
  const { userId, myOrgs, myOrgsLoaded } = useProfile()

  const updateQuery = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  const periodParam = searchParams.get('period')
  const period: Period = isPeriod(periodParam) ? periodParam : 'last_quiz'
  function setPeriod(p: Period) {
    // Nytt periodevalg nullstiller historikk-fanens URL-state også — samme
    // oppførsel som før (se den fjernede period-reset-effekten under).
    updateQuery({ period: p === 'last_quiz' ? null : p, hist: null, histKey: null })
  }

  const [data, setData]               = useState<ApiResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(false)
  const [session, setSession]         = useState<Session | null>(null)
  // sessionChecked: true etter at getSession() har svart — brukes til å
  // skjule "Logg inn"-kortet til vi vet om brukeren faktisk er innlogget
  const [sessionChecked, setSessionChecked] = useState(false)
  const [pointsOpen, setPointsOpen]   = useState(false)

  // ── Paginering + søk (kun Premium, periode-modus) ───────────────────────────
  const [browseMode, setBrowseMode]   = useState(false)   // false = klassisk topp-10
  const [pageNo, setPageNo]           = useState(1)
  const [searchInput, setSearchInput] = useState('')      // rå input
  const [search, setSearch]           = useState('')      // debounced, sendt til API

  const histOpen                        = searchParams.get('hist') === '1'
  const expandedKey                     = searchParams.get('histKey')
  const [histData, setHistData]         = useState<HistoryEntry[] | null>(null)
  const [histLoading, setHistLoading]   = useState(false)
  const [expandedData, setExpandedData] = useState<Map<string, ExpandedEntry[] | 'loading'>>(new Map())

  // ── H2H Duell ("Utfordre") ──────────────────────────────────────────────────
  const [challengeLoadingId, setChallengeLoadingId] = useState<string | null>(null)
  const [challengeSentSet, setChallengeSentSet]     = useState<Set<string>>(new Set())
  const [duelInvolvedSet, setDuelInvolvedSet]       = useState<Set<string>>(new Set())
  const [activeDuelExists, setActiveDuelExists]     = useState(false)
  const [challengeError, setChallengeError]         = useState<{ rivalId: string; message: string } | null>(null)
  const challengeErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pendingChallenge, setPendingChallenge]     = useState<{ id: string; name: string } | null>(null)

  // Dedupe-vakt (samme prinsipp som AuthListener.tsx): getSession() OG
  // onAuthStateChange(INITIAL_SESSION) leverer begge samme sesjon ved mount,
  // som uten vakt dobbelt-trigget /api/rivalries/my (avhenger av hele
  // session-objektet, som er en ny referanse hver gang). Sammenligner på
  // access_token i stedet for en ren "kun første gang"-ref, slik at et ekte
  // senere TOKEN_REFRESHED fortsatt slipper gjennom — session.access_token
  // brukes aktivt i etterfølgende autentiserte kall (utfordring, historikk,
  // paginering) og må ikke fryses/bli foreldet.
  useEffect(() => {
    const applySession = (s: Session | null) => {
      setSession(prev => (prev?.access_token === s?.access_token ? prev : s))
      setSessionChecked(true)
    }
    // ── Tidsgrense på getSession() (7. august 2026) ──────────────────────────
    // Samme sikkerhetsventil, samme 1500 ms, som AuthListener allerede har mot
    // auth-lås-konflikt. Den ble nødvendig HER da scopede kall begynte å vente
    // på `sessionChecked` (se scopedFetchReady under): henger getSession, blir
    // flagget aldri satt, og org-/ligatopplisten står i skjelettet for alltid.
    // Før ventingen fantes, fyrte hentingen umiddelbart og en treg getSession
    // kunne ikke låse noe.
    //
    // Ved timeout settes KUN `sessionChecked` — ikke `session`. Å kalle
    // applySession(null) ville påstått «utlogget» og gitt en ekte innlogget
    // bruker «Logg inn»-kortet; her sier vi bare at vi ikke lenger venter, og
    // onAuthStateChange (uendret backup, den mer pålitelige av de to) setter
    // sesjonen når den lander.
    withTimeout(supabase.auth.getSession(), { ms: SESSION_CHECK_MS }).then(outcome => {
      const decision = decideSessionCheck(outcome)
      if (decision.applySession) applySession(decision.session)
      else setSessionChecked(decision.checked)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => applySession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Hent duell-status for "Utfordre"-knapp i topplisterad
  useEffect(() => {
    if (!session?.access_token) {
      setActiveDuelExists(false)
      setDuelInvolvedSet(new Set())
      setChallengeSentSet(new Set())
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/rivalries/my', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok || cancelled) return
        const json = await res.json()
        const rows: { status: string; isChallenger: boolean; opponentId: string; isExpired: boolean }[] = json.rivalries ?? []
        // Kun ikke-utløpte aktive/ventende dueller blokkerer nye utfordringer (declined teller ikke).
        const engagedRows = rows.filter(r => !r.isExpired && r.status !== 'declined')
        if (cancelled) return
        setActiveDuelExists(engagedRows.length > 0)
        setDuelInvolvedSet(new Set(engagedRows.map(r => r.opponentId)))
        setChallengeSentSet(new Set(
          engagedRows.filter(r => r.status === 'pending' && r.isChallenger).map(r => r.opponentId)
        ))
      } catch { /* ikke kritisk */ }
    })()
    return () => { cancelled = true }
  // Hele session-OBJEKTET som dep er trygt HER, i motsetning til /premium,
  // /bedrift/success og org/[slug]/velkommen: beskyttelsen bor hos SKRIVEREN,
  // ikke i dep-lista. `applySession` over returnerer forrige objekt når
  // access_token er uendret, så de to mount-skriverne (getSession() og
  // onAuthStateChange sin INITIAL_SESSION) gir aldri to ULIKE referanser for
  // samme logiske sesjon. Vurdert 12. august 2026 og bevisst latt stå — å bytte
  // til getSessionIdentity her ville ikke fjernet et eneste kall.
  }, [session])

  useEffect(() => {
    return () => {
      if (challengeErrorTimerRef.current) clearTimeout(challengeErrorTimerRef.current)
    }
  }, [])

  const handleChallenge = async (rivalId: string) => {
    if (!session) return
    setChallengeLoadingId(rivalId)
    setChallengeError(null)
    try {
      const res = await fetch('/api/rivalries', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rival_id: rivalId }),
      })
      if (res.ok) {
        setChallengeSentSet(prev => new Set([...prev, rivalId]))
        setDuelInvolvedSet(prev => new Set([...prev, rivalId]))
        setActiveDuelExists(true)
      } else {
        const json = await res.json().catch(() => ({}))
        const msg = json.error ?? 'Noe gikk galt.'
        setChallengeError({ rivalId, message: msg })
        if (challengeErrorTimerRef.current) clearTimeout(challengeErrorTimerRef.current)
        challengeErrorTimerRef.current = setTimeout(() => setChallengeError(null), 3000)
      }
    } catch {
      setChallengeError({ rivalId, message: 'Noe gikk galt.' })
      if (challengeErrorTimerRef.current) clearTimeout(challengeErrorTimerRef.current)
      challengeErrorTimerRef.current = setTimeout(() => setChallengeError(null), 3000)
    }
    setChallengeLoadingId(null)
  }

  // Debounce søkefelt → search (sendt til API). Tomt søk = klassisk topp-10.
  useEffect(() => {
    const t = setTimeout(() => {
      const v = searchInput.trim()
      setSearch(v)
      setPageNo(1)
      setBrowseMode(v !== '')
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Hent toppliste-data
  // Kjøres umiddelbart ved mount (session=null → anonymt kall), og på nytt
  // når session ankommer med access_token (for innloggede brukere).
  // Bruker session?.user?.id i dep-arrayen for å unngå ekstra re-fetch
  // ved token-refresh (samme bruker, nytt token).
  const sessionUserId = session?.user?.id ?? null
  // Scopede kall (org/liga) venter til getSession() har svart: første fetch
  // gikk ellers anonymt og får nå 401 fra scope-gaten i /api/toppliste — et
  // blaff av «Logg inn»-kortet for ekte medlemmer ved hver sidelast, pluss et
  // bortkastet kall. 'global' er konstant true slik at dep-en aldri endres og
  // den offentlige topplisten er bevislig uendret (ingen ekstra re-fetch for
  // anonyme når sessionChecked lander).
  const scopedFetchReady = scope === 'global' ? true : sessionChecked
  useEffect(() => {
    if (!scopedFetchReady) return // initial loading=true → skeleton står
    let cancelled = false
    setLoading(true)
    // Fjern data (vis skeleton) ved periode-/sidebytte og initial last.
    // Ved session-re-fetch endres sessionUserId, men browseMode er false —
    // vi aksepterer den korte skeleton-blinken fordi det er bedre enn å
    // vise feil periodes data mens ny hentes.
    if (!browseMode) setData(null)
    setLoadError(false)

    async function load() {
      const headers: Record<string, string> = {}
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      try {
        let url = `/api/toppliste?period=${period}&scope=${scope}`
        if (scopeId) url += `&scope_id=${encodeURIComponent(scopeId)}`
        if (browseMode) {
          url += `&page=${pageNo}`
          if (search) url += `&search=${encodeURIComponent(search)}`
        }
        const res = await fetch(url, { headers })
        if (cancelled) return
        if (!res.ok) { if (!cancelled) { setData(null); setLoadError(true) }; return }
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) { setData(null); setLoadError(true) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  // sessionUserId (ikke session) for å unngå re-fetch ved token-refresh
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, sessionUserId, scope, scopeId, browseMode, pageNo, search, scopedFetchReady])

  // Reset historikk-cache + paginering når periode bytter. hist/histKey
  // trenger ikke nullstilles her lenger — de er URL-styrt, og setPeriod()
  // over nullstiller dem allerede eksplisitt ved fanebytte.
  useEffect(() => {
    setHistData(null)
    setExpandedData(new Map())
    setBrowseMode(false)
    setPageNo(1)
    setSearchInput('')
    setSearch('')
  }, [period])

  // Hent historikk-data (lat)
  const loadHistory = useCallback(async () => {
    if (histData !== null || period === 'alltime') return
    setHistLoading(true)
    try {
      let url = `/api/toppliste/history?period=${period}&scope=${scope}`
      if (scopeId) url += `&scope_id=${encodeURIComponent(scopeId)}`
      const histHeaders: Record<string, string> = {}
      if (session?.access_token) histHeaders['Authorization'] = `Bearer ${session.access_token}`
      const res = await fetch(url, { headers: histHeaders })
      if (res.ok) {
        const json = await res.json()
        setHistData(json.entries ?? [])
      } else {
        setHistData([])
      }
    } catch {
      setHistData([])
    } finally {
      setHistLoading(false)
    }
  }, [histData, period, scope, scopeId, session])

  // Åpner automatisk når `hist=1` finnes i URL-en — ikke bare ved klikk på
  // akkordionen, men også ved direktelast/delt lenke (f.eks. fra en
  // historisk quiz sin "Se sesong-topplisten"-retur-lenke). loadHistory sin
  // egen guard (histData !== null) gjør at dette ikke dobbelt-henter ved
  // rene URL-endringer som ikke gjelder hist.
  useEffect(() => {
    if (histOpen) loadHistory()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histOpen, period])

  const toggleHistory = () => {
    updateQuery({ hist: histOpen ? null : '1' })
  }

  // Henter topp 10 for en historisk periode. Kalles både ved klikk
  // (loadExpanded under) og automatisk når ?histKey= finnes i URL-en ved
  // mount/direktelast (effekten rett under).
  async function fetchExpanded(key: string) {
    if (expandedData.has(key)) return
    setExpandedData(prev => new Map(prev).set(key, 'loading'))
    try {
      const range = getPeriodRange(key, period as 'month' | 'quarter' | 'year')
      let url = `/api/toppliste?scope=${scope}&period_start=${encodeURIComponent(range.start)}&period_end=${encodeURIComponent(range.end)}&period=${period}`
      if (scopeId) url += `&scope_id=${encodeURIComponent(scopeId)}`
      const expandHeaders: Record<string, string> = {}
      if (session?.access_token) expandHeaders['Authorization'] = `Bearer ${session.access_token}`
      const res = await fetch(url, { headers: expandHeaders })
      if (!res.ok) throw new Error()
      const json = await res.json()
      const entries: ExpandedEntry[] = (json.entries ?? []).map((e: Entry) => ({
        rank: e.rank, userId: e.userId, displayName: e.displayName, nickname: e.nickname ?? null,
        avatarUrl: e.avatarUrl, points: e.points, quizCount: e.quizCount,
      }))
      setExpandedData(prev => new Map(prev).set(key, entries))
    } catch {
      setExpandedData(prev => new Map(prev).set(key, []))
    }
  }

  function loadExpanded(key: string) {
    updateQuery({ histKey: expandedKey === key ? null : key })
  }

  useEffect(() => {
    if (expandedKey) fetchExpanded(expandedKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey])

  // Bygger lenken fra en rad i "Tidligere quizer" til quizens egen
  // resultatside. org/league-parameteren holder riktig scope gjennom
  // navigasjonen (parallelt mønster for begge); hist=1 signaliserer til
  // app/leaderboard/[id]/page.tsx at brukeren kom fra historikk-lista, slik
  // at "Se sesong-topplisten"-lenken der kan ta dem rett tilbake til samme
  // åpne fane i stedet for "Siste quiz".
  function buildQuizHref(quizId: string): string {
    const qp = new URLSearchParams()
    if (scope === 'organization' && orgSlug) qp.set('org', orgSlug)
    if (scope === 'league' && leagueSlug) qp.set('league', leagueSlug)
    qp.set('hist', '1')
    return `/leaderboard/${quizId}?${qp.toString()}`
  }

  const countdown  = getCountdown(period)
  const currentUserId = session?.user?.id ?? null
  const isLastQuiz = period === 'last_quiz'
  // Badges (krone/medalje/lyn/flamme) gir kun mening i klassisk topp-visning
  const badges     = (data && !browseMode) ? assignBadges(data.entries) : new Map<string, BadgeKind>()
  const showHistory = period !== 'alltime'
  const emptyText  = EMPTY_TEXT[period]

  // ── Paginerings-/søke-avledninger (Premium, periode-modus) ──────────────────
  const isPremium     = data?.userIsPremium === true
  const totalCount    = data?.totalCount ?? 0
  const userRank      = data?.userRank ?? null
  // ÉN avledet sidestørrelse for hele komponenten — knappe-etiketter,
  // totalPages, «Gå til min plassering» og søketeksten skal aldri kunne bruke
  // hvert sitt tall. Serverens `pageSize` vinner; PAGE_SIZE (= den delte
  // TOPPLISTE_PAGE_SIZE) er fallback før første svar.
  const effectivePageSize = data?.pageSize ?? PAGE_SIZE
  const totalPages    = Math.max(1, Math.ceil(totalCount / effectivePageSize))
  const userVisible   = !!(currentUserId && data?.entries.some(e => e.userId === currentUserId))
  const searching     = browseMode && search.trim() !== ''
  // Kontrollene vises kun for Premium i periode-modus når listen er lengre enn topp-10
  const showControls  = (isPremium || scope === 'organization') && (totalCount > 10 || browseMode)
  const showJumpToMe  = showControls && userRank != null && !userVisible && !searching

  function goToPage(p: number) {
    // Kun synlig når man ikke søker, så søketilstand trenger ikke nullstilles her
    setPageNo(p)
    setBrowseMode(true)
  }
  function goToMyPlacement() {
    if (userRank == null) return
    goToPage(Math.max(1, Math.ceil(userRank / effectivePageSize)))
  }
  // Kompakt sideliste med ellipser: 1 … rundt-nåværende … siste
  function pageWindow(current: number, total: number): (number | 'gap')[] {
    const wanted = [...new Set([1, 2, current - 1, current, current + 1, total - 1, total])]
      .filter(n => n >= 1 && n <= total)
      .sort((a, b) => a - b)
    const out: (number | 'gap')[] = []
    let prev = 0
    for (const n of wanted) {
      if (prev && n - prev > 1) out.push('gap')
      out.push(n)
      prev = n
    }
    return out
  }
  const intervalLabel = (p: number) => `${(p - 1) * effectivePageSize + 1}–${Math.min(p * effectivePageSize, totalCount)}`

  // ── Row renderers ─────────────────────────────────────────────────────────

  // Ren mapper for ALLE faner — Siste quiz konvertert til tabellformat
  // 26. juli 2026, periode-visningene (måned/kvartal/år/all-time) fulgte
  // 28. juli 2026 (forslag 2/«Kompakt» fra periode-tabell-final-spec).
  // Samme mønster som app/leaderboard/[id]/page.tsx og org-admin.
  // Forskjellen mellom de to formene er kun hvilke ResultsTable-props
  // kalles med (se rows-JSX under) — «Riktige»/«Tid» for Siste quiz,
  // «Poeng»/skjult tidskolonne for periode-visninger, hvor quizCount i
  // stedet vises som metricSubLabel under poengtallet. Avatar droppet (som
  // i de andre konverteringene); merket flyttes inn i Navn-cellen.
  function entryToRow(entry: Entry): ResultsTableRow {
    const badge = badges.get(entry.userId) ?? null
    const isSelf = entry.userId === currentUserId
    const nick = entry.nickname?.trim()
    const hasNick = !!nick

    // Delt med app/leaderboard/[id]/page.tsx sin attemptToRow/browseEntryToRow
    // — se lib/duel-affordance.ts.
    const { clickable, alreadySent } = computeDuelAffordance(entry.userId, isSelf, {
      currentUserId, duelInvolvedIds: duelInvolvedSet, challengeSentIds: challengeSentSet, activeDuelExists, challengeLoadingId,
    })
    const trailingLabel = alreadySent ? 'Duell sendt!' : null

    return {
      key: entry.userId,
      rank: entry.rank,
      name: hasNick ? nick! : entry.displayName,
      secondary: hasNick ? entry.displayName : null,
      correctAnswers: entry.points,
      totalTimeMs: entry.fastestMs ?? 0,
      metricSubLabel: isLastQuiz ? null : formatQuizCount(entry.quizCount),
      highlight: isSelf,
      badge,
      clickable,
      trailingLabel,
      clickHint: clickable ? 'Utfordre' : null,
      ariaLabel: clickable ? `Utfordre ${entry.displayName} til duell` : null,
      note: challengeError?.rivalId === entry.userId
        ? { text: challengeError.message, tone: 'error' }
        : null,
    }
  }

  // «Din plassering»: brukerens egen rad føyes til SAMME tabell (ikke et
  // eget kort) med en separator rett over — mønster fra
  // app/leaderboard/[id]/page.tsx sin renderSection(). Gjelder nå ALLE
  // faner (Siste quiz fikk fastestMs på userEntry fra API-et 28. juli 2026,
  // se app/api/toppliste/route.ts sin last_quiz-gren).
  function buildRows(): ResultsTableRow[] {
    const rows = (data?.entries ?? []).map(entryToRow)
    if (!shouldShowPlacementRow({
      userVisible, userEntryRank: data?.userEntry?.rank ?? null,
      isPremium: data?.userIsPremium === true, scope,
      // Blokkert kallers userEntry bærer «egne tall» med rank mot det
      // UFILTRERTE feltet — den skal aldri tegnes inn i den offentlige listen.
      userBlockedFromGlobal: data?.userBlockedFromGlobal === true,
    })) return rows

    rows.push(buildPlacementRow(data!.userEntry!, isLastQuiz))
    return rows
  }

  function renderUserSection() {
    if (!sessionChecked) return null
    if (!session) {
      return (
        <>
          <div style={s.sectionHeader}>
            <span style={s.sectionText}>Din plassering</span>
            <div style={s.sectionLine} />
          </div>
          <div style={s.userCard}>
            <p style={s.ctaText}>Logg inn for å se din plassering på topplisten.</p>
            <Link href={loginHref} style={s.btnGold}>Logg inn</Link>
          </div>
        </>
      )
    }
    if (!data) return null

    // ── Blokkert fra den åpne topplisten (stengt org / eget opt-out) ─────────
    // Si det som er sant i stedet for «Du spilte ikke ukens quiz.» / «Du har
    // ikke spilt ennå …» — begge var usanne for en blokkert som spilte (funn 3,
    // 5. august 2026; samme feilklasse som «Reaktiver Premium»). Grenen står
    // FØR ue-grenene: fallback-userEntry kan ha rank <= 10, og uten denne ville
    // «return null» under svelget hele seksjonen. Kun global — org/liga er
    // interne rom der de blokkerte hører hjemme og vises som normalt.
    if (scope === 'global' && data.userBlockedFromGlobal) {
      // Hvilken org å navngi — og HVORFOR brukeren står utenfor — avgjøres av de
      // rene funksjonene i lib/placement-visibility.ts, ikke av en betingelse
      // her. `myOrgs[0]` holdt ikke: ved flere medlemskap er det den BLOKKERENDE
      // raden som forklarer utestengelsen, og en årsak lest av feil rad ville
      // påstå noe usant (samme risiko som resultatskjermen, ab74097).
      const placement = decidePlacementDisplay({ userId, orgsLoaded: myOrgsLoaded, orgs: myOrgs })
      const blockingOrg = placement.mode === 'internal-only' ? placement.org : null
      // Fallback beholdt for det ene tilfellet der ingen nåværende org blokkerer:
      // periode-/quiz-flagget kan være HISTORISK (deriveBlockedFromScores —
      // vedtaket den gang quizen ble gjort opp), og da finnes ingen årsak å
      // påstå i dag. Da vises kortet som før, uten årsakslinje.
      const internalHome = blockingOrg ?? (myOrgsLoaded && myOrgs.length > 0 ? myOrgs[0] : null)
      const reason = blockingOrg ? globalExclusionReason(blockingOrg) : null
      return (
        <>
          <div style={s.sectionHeader}><span style={s.sectionText}>Din plassering</span><div style={s.sectionLine} /></div>
          <div style={s.userCard}>
            {/* Ordlyd godkjent av Dennis 5. august 2026: periode-teksten skal
                si hvor poengene FAKTISK teller — «inngår ikke» alene kunne
                leses som at de er borte. Navnefallbacken («i bedriften din»)
                dekker vinduet før myOrgs har landet; periode-flagget forut-
                setter et levende org-medlemskap server-side, så «bedriften
                din» er alltid sant der. */}
            <p style={{ ...s.ctaText, marginBottom: reason ? 8 : internalHome ? 14 : 0 }}>
              {isLastQuiz
                ? 'Du spilte ukens quiz — resultatet ditt vises ikke i den åpne topplisten.'
                : `Poengene dine teller internt hos ${internalHome ? internalHome.orgName : 'bedriften din'}, ikke i den åpne topplisten.`}
            </p>
            {/* ── Årsaken, som egen linje ────────────────────────────────────
                Setningen over sier HVA som skjer og er ordrett den Dennis
                godkjente 5. august; denne sier HVORFOR. De to årsakene må ikke
                forveksles: «bedriften har valgt» til en som selv slo det av er
                en usann påstand om arbeidsgiveren, og «du har valgt» til en
                ansatt i en stengt org sender henne til en profilbryter uten
                effekt (org-policyen overstyrer — se
                /api/org/[slug]/league-preference). Derfor vinner org-policyen
                når begge er sanne, avgjort av globalExclusionReason().
                Hint-farge og ingen gull: dette er en forklaring, ikke en
                handling, og kortet har allerede sin ene knapp. ── */}
            {blockingOrg && reason && (
              <p style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.6, marginBottom: 14 }}>
                {reason === 'org-policy' ? (
                  <>{blockingOrg.orgName} har valgt at ansatte konkurrerer internt.</>
                ) : (
                  <>
                    Du har selv valgt å ikke vises på den åpne topplisten.{' '}
                    <Link href="/profil" style={{ color: '#e8e4dd', textDecoration: 'underline' }}>Endre i profilen</Link>
                  </>
                )}
              </p>
            )}
            {internalHome && (
              <Link href={`/org/${internalHome.orgSlug}`} style={s.btnOutline}>
                Se topplisten hos {internalHome.orgName} &rarr;
              </Link>
            )}
          </div>
        </>
      )
    }

    // Allerede synlig (fremhevet) i listen — eget plasserings-kort er overflødig
    if (userVisible) return null

    const ue = data.userEntry
    if (ue && ue.rank <= 10) return null

    if (ue && ue.rank > 10) {
      if (!data.userIsPremium && scope !== 'organization') {
        return (
          <>
            <div style={s.sectionHeader}><span style={s.sectionText}>Din plassering</span><div style={s.sectionLine} /></div>
            <div style={s.userCard}>
              <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 6 }}>
                Du er utenfor topp 10. Med Premium ser du din nøyaktige plassering og full statistikk.
              </p>
              <Link href="/premium" style={s.btnOutline}>Oppgrader til Premium</Link>
            </div>
          </>
        )
      }
      // Denne raden vises nå INNE i tabellen via buildRows()/
      // shouldShowPlacementRow (alle faner, siden 28. juli 2026), ikke
      // som eget kort — se lib/season-period-table.ts.
      return null
    }

    const quizStillOpen = !isLastQuiz && data?.activeQuizClosesAt && new Date(data.activeQuizClosesAt) > new Date()
    const notPlayedMsg = quizStillOpen
      ? 'Poeng registreres når ukens quiz stenger. Kom tilbake for å se plasseringen din.'
      : NOT_PLAYED_TEXT[period]

    return (
      <>
        <div style={s.sectionHeader}><span style={s.sectionText}>Din plassering</span><div style={s.sectionLine} /></div>
        <div style={s.userCard}>
          <p style={{ ...s.ctaText, marginBottom: 12 }}>{notPlayedMsg}</p>
          <Link href="/" style={s.btnOutline}>Se ukens quiz →</Link>
        </div>
      </>
    )
  }

  function renderHistoryRow(entry: HistoryEntry, isLast: boolean) {
    const label   = isLastQuiz ? entry.label : formatHistoryLabel(entry.key, period)
    const initial = getAvatarInitial(entry.winner?.displayName)
    const isExpanded = expandedKey === entry.key
    const expanded   = expandedData.get(entry.key)

    if (isLastQuiz) {
      const rowStyle = isLast ? s.histRowQuizLast : s.histRowQuiz
      return (
        <div key={entry.key}>
          <div style={rowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.histPeriodLabel}>{label}</div>
              {entry.winner && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <div style={s.histAvatarSm}>
                    {entry.winner.avatarUrl
                      ? <img src={entry.winner.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                      : initial
                    }
                  </div>
                  <span style={s.histWinnerName}>{entry.winner.nickname?.trim() || entry.winner.displayName}</span>
                  <span style={s.histWinnerScore}>{entry.winner.score} {entry.winner.scoreLabel}</span>
                </div>
              )}
              {!entry.winner && <div style={{ fontSize: 12, color: '#e8e4dd', marginTop: 4 }}>Ingen innloggede spillere</div>}
            </div>
            {entry.quizId && (
              <Link
                href={buildQuizHref(entry.quizId)}
                style={{ fontSize: 12, color: '#e8e4dd', textDecoration: 'none', flexShrink: 0, marginLeft: 12 }}
              >
                Se toppliste →
              </Link>
            )}
          </div>
        </div>
      )
    }

    const rowStyle = isLast && !isExpanded ? s.histRowLast : s.histRow
    return (
      <div key={entry.key}>
        <div style={rowStyle} onClick={() => loadExpanded(entry.key)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && loadExpanded(entry.key)}>
          <div style={s.histPeriodLabel}>{label}</div>
          <div style={s.histWinner}>
            {entry.winner ? (
              <>
                <div style={s.histAvatarSm}>
                  {entry.winner.avatarUrl
                    ? <img src={entry.winner.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                    : initial
                  }
                </div>
                <span style={s.histWinnerName}>{entry.winner.displayName}</span>
                <span style={s.histWinnerScore}>{entry.winner.score} {entry.winner.scoreLabel}</span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: '#e8e4dd' }}>Ingen data</span>
            )}
          </div>
          <span style={s.histChevron}>{isExpanded ? '↑' : '↓'}</span>
        </div>
        {isExpanded && expanded !== undefined && (
          <div style={s.expandedWrap}>
            {expanded === 'loading' ? (
              <div style={s.expandedSpin}>Laster…</div>
            ) : expanded.length === 0 ? (
              <div style={s.expandedSpin}>Ingen data for denne perioden</div>
            ) : (
              expanded.map((e, i) => (
                <div key={e.userId} style={{ ...s.expandedRow, borderBottom: i === expanded.length - 1 ? 'none' : '0.5px solid rgba(42,45,56,0.6)' }}>
                  <span style={s.expandedRank}>#{e.rank}</span>
                  <span style={s.expandedName}>{e.nickname?.trim() || e.displayName}</span>
                  <span style={s.expandedScore}>{e.points} poeng</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  function renderHistoryAccordion() {
    if (!showHistory) return null
    const title = HISTORY_TITLE[period as Exclude<Period, 'alltime'>]
    return (
      <div className="tp-accordion-wrap" style={s.histAccordion}>
        <button className="tp-accordion-btn" onClick={toggleHistory}>
          <span style={s.histHeaderTitle}>{title}</span>
          <span style={s.histHeaderChev}>{histOpen ? '↑' : '↓'}</span>
        </button>
        {histOpen && (
          <div style={s.histBody}>
            {histLoading ? (
              <div style={s.histEmpty}>Laster…</div>
            ) : !histData || histData.length === 0 ? (
              <div style={s.histEmpty}>Ingen avsluttede perioder ennå — kom tilbake om en stund</div>
            ) : (
              histData.map((entry, i) => renderHistoryRow(entry, i === histData.length - 1))
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <>
        <style>{FONT_IMPORT + EXTRA_STYLES}</style>
        <SkeletonCard rows={8} showHeader style={{ marginTop: 16 }} />
      </>
    )
  }

  if (!loading && !data) {
    const loginHref = `/login?next=/toppliste`
    const showError = loadError && sessionChecked && !!session
    return (
      <>
        <style>{FONT_IMPORT + EXTRA_STYLES}</style>
        <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '36px 28px', textAlign: 'center' }}>
          {showError ? (
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff' }}>
              Noe gikk galt. Prøv å laste siden på nytt.
            </p>
          ) : (
            <>
              <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 8 }}>
                Ingen data ennå
              </p>
              <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 16 }}>
                Logg inn for å se din sesong-plassering.
              </p>
              <Link href={loginHref} style={{ display: 'inline-block', background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 24px', borderRadius: 10, textDecoration: 'none' }}>
                Logg inn
              </Link>
            </>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <style>{FONT_IMPORT + EXTRA_STYLES}</style>

      {/* Fane-rad */}
      <div className="tp-tab-row" style={s.tabRow}>
        {(['last_quiz', 'month', 'quarter', 'year', 'alltime'] as Period[]).map(p => (
          <button key={p} style={period === p ? s.tabActive : s.tabInactive} onClick={() => setPeriod(p)}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {scope === 'organization' && globalLeagueDisabled && (
        <p style={{ fontSize: 13, color: '#e8e4dd', textAlign: 'center', margin: '8px 0 4px' }}>
          Global konkurranse er deaktivert for din bedrift.
        </p>
      )}

      {isLastQuiz && data?.quizTitle && (
        <p style={s.quizLabel}>Siste quiz: <em>{data.quizTitle}</em></p>
      )}

      {isLastQuiz && data?.quizClosesAt && new Date(data.quizClosesAt) > new Date() && (
        <p style={{ fontSize: 13, color: '#e8e4dd', textAlign: 'center', marginBottom: 16 }}>
          Quizen er åpen — resultater oppdateres fortløpende
        </p>
      )}

      {countdown && <p style={s.countdown}>{countdown}</p>}

      {/* Poengforklaring — skjult for last_quiz */}
      {!isLastQuiz && (
        <div className="tp-accordion-wrap" style={{ marginBottom: 16 }}>
          <button className="tp-accordion-btn" onClick={() => setPointsOpen(o => !o)}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd' }}>Hvordan beregnes poeng?</span>
            <span style={{ fontSize: 11, color: '#c9a84c' }}>{pointsOpen ? '↑' : '↓'}</span>
          </button>
          {pointsOpen && (
            <div style={{ background: '#21242e', borderTop: '1px solid #2a2d38', padding: '14px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 10 }}>Poengfordeling per quiz</div>
              {[['1. plass','12 poeng'],['2. plass','10 poeng'],['3. plass','8 poeng'],['4. plass','7 poeng'],['5. plass','6 poeng'],['6. plass','5 poeng'],['7. plass','4 poeng'],['8. plass','3 poeng'],['9. plass','2 poeng'],['10. plass','1 poeng'],['11+ plass','1 poeng']].map(([place, pts]) => (
                <div key={place} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#e8e4dd', padding: '3px 0', borderBottom: '0.5px solid #2a2d38' }}>
                  <span style={{ color: '#e8e4dd' }}>{place}</span>
                  <span style={{ fontWeight: 600 }}>{pts}</span>
                </div>
              ))}
              <p style={{ fontSize: 11, color: '#e8e4dd', fontStyle: 'italic', marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
                Poengene summeres over alle quizer i perioden. Konsistens belønnes.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Søk + gå-til-min-plassering (Premium, periode-modus) */}
      {showControls && (
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Søk etter navn…"
            style={{
              width: '100%', boxSizing: 'border-box', background: 'transparent',
              border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px',
              fontSize: 14, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none',
            }}
          />
          {showJumpToMe && (
            <button
              onClick={goToMyPlacement}
              style={{
                marginTop: 10, background: 'transparent', color: '#e8e4dd',
                border: '1px solid #e8e4dd', borderRadius: 10, padding: '10px 28px',
                fontSize: 14, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif",
                cursor: 'pointer', width: 'auto',
              }}
            >
              Gå til min plassering (#{userRank})
            </button>
          )}
          {searching && (
            <p style={{ fontSize: 12, color: '#918f8a', marginTop: 8 }}>
              {totalCount === 0
                ? `Ingen treff på «${search}».`
                : totalCount > effectivePageSize
                  ? `Viser de ${effectivePageSize} første av ${totalCount} treff. Forsøk et mer spesifikt søk.`
                  : `${totalCount} ${totalCount === 1 ? 'treff' : 'treff'}.`}
            </p>
          )}
        </div>
      )}

      {/* Liste */}
      {!loading && data?.entries.length === 0 ? (
        searching ? null : (() => {
          const quizStillOpen = !isLastQuiz && data?.activeQuizClosesAt && new Date(data.activeQuizClosesAt) > new Date()
          // Lenken til forsiden er poenget med en tom liste: uten den var
          // «Spill en quiz for å komme på listen!» en oppfordring uten noe å
          // trykke på — særlig for et ferskt org-medlem, som lander her rett
          // etter innmelding og ellers ikke får vite hvor quizen bor.
          if (quizStillOpen) {
            return (
              <div style={s.empty}>
                <p style={s.emptyTitle}>Poeng beregnes etter quizen</p>
                <p style={{ ...s.emptySub, marginBottom: 18 }}>
                  Poeng for ukens quiz registreres når quizen stenger. Kom tilbake senere for oppdatert toppliste.
                </p>
                <Link href="/" style={s.btnOutline}>Se ukens quiz &rarr;</Link>
              </div>
            )
          }
          return (
            <div style={s.empty}>
              <p style={s.emptyTitle}>{emptyText.title}</p>
              <p style={{ ...s.emptySub, marginBottom: 18 }}>{emptyText.sub}</p>
              <Link href="/" style={s.btnOutline}>Se ukens quiz &rarr;</Link>
            </div>
          )
        })()
      ) : (
        <ResultsTable
          rows={buildRows()}
          formatTime={formatTime}
          correctLabel={isLastQuiz ? undefined : 'Poeng'}
          showTimeColumn={isLastQuiz}
          onRowClick={row => setPendingChallenge({ id: row.key, name: row.name })}
        />
      )}

      {/* Sidenavigasjon (Premium) */}
      {showControls && !searching && totalPages > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 16 }}>
          {pageWindow(pageNo, totalPages).map((p, i) =>
            p === 'gap'
              ? <span key={`gap-${i}`} style={{ color: '#918f8a', padding: '6px 4px', fontSize: 12 }}>…</span>
              : <button
                  key={p}
                  onClick={() => goToPage(p)}
                  style={{
                    background: p === pageNo ? 'rgba(201,168,76,0.12)' : 'transparent',
                    border: `1px solid ${p === pageNo ? '#c9a84c' : '#2a2d38'}`,
                    color: p === pageNo ? '#c9a84c' : '#e8e4dd',
                    borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600,
                    fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const,
                  }}
                >
                  {intervalLabel(p)}
                </button>
          )}
        </div>
      )}

      {/* Historikk-accordion */}
      {renderHistoryAccordion()}

      {/* Din plassering */}
      {renderUserSection()}

      {/* Badge-forklaring */}
      <div style={{ marginTop: 24, padding: '0 2px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#918f8a', marginBottom: 10 }}>Hva betyr badgene?</div>
        <div style={s.legendRow}><BadgeCircle badge="krone" size={20} /><span>Krone — #1 på topplisten denne perioden</span></div>
        <div style={s.legendRow}><BadgeCircle badge="flamme" size={20} /><span>Flamme — lengst streak, minst 3 uker på rad (deltatt teller, uansett resultat)</span></div>
        <div style={s.legendRow}><BadgeCircle badge="lyn" size={20} /><span>Lyn — raskeste fullførte quiz</span></div>
        <div style={{ ...s.legendRow, marginBottom: 0 }}><BadgeCircle badge="medalje" size={20} /><span>Medalje — topp 3 denne perioden</span></div>
      </div>

      {/* Duell-bekreftelse — delt komponent, samme som leaderboard/[id] og
          quiz-resultatskjermen. Erstattet en lokal inline-kopi som manglet
          role="dialog"/aria-modal/aria-labelledby, Escape-lukking,
          bakgrunnsklikk-lukking og scroll-lås (FUNN 1.1). */}
      <DuelChallengeModal
        pending={pendingChallenge}
        onCancel={() => setPendingChallenge(null)}
        onConfirm={id => { setPendingChallenge(null); handleChallenge(id) }}
      />
    </>
  )
}
