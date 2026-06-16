'use client'
import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import { useParams } from 'next/navigation'
import { supabase, supabaseData, Quiz, Attempt } from '@/lib/supabase'
import { rankAttempts, getMedal, RankedAttempt } from '@/lib/ranking'
import { getSession, signOut } from '@/lib/auth'
import AuthModal from '@/components/AuthModal'
import Link from 'next/link'
import SkeletonCard from '@/components/SkeletonCard'
import type { Session } from '@supabase/supabase-js'

const podiumStyles = `
  @keyframes podiumSlideIn {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .podium-row-3 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 0ms; }
  .podium-row-2 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 400ms; }
  .podium-row-1 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 1000ms; }
  @keyframes podiumFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .podium-rest  { animation: podiumFadeIn 200ms ease-out both; animation-delay: 1400ms; }

  @media (min-width: 769px) {
    .qk-lb-card        { padding: 28px 32px !important; }
    .qk-lb-result-wrap { flex-direction: row !important; align-items: center !important; justify-content: space-between !important; text-align: left !important; padding: 16px 24px !important; gap: 20px !important; }
    .qk-lb-hero-score  { font-size: 36px !important; }
    .qk-lb-score-label { font-size: 18px !important; }
    .qk-lb-meta-row    { justify-content: flex-end !important; }
  }
`

const s = {
  wrap:         { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' },
  page:         { maxWidth: 680, margin: '0 auto', padding: '0 20px 80px' },
  centered:     { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  centeredText: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' as const },

  header:   { padding: '48px 0 36px', textAlign: 'center' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' },
  eyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  title:    { fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(28px, 6vw, 38px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 },
  titleEm:  { fontStyle: 'italic', color: '#c9a84c' },
  subtitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 14, color: '#e8e4dd', fontStyle: 'italic' as const },
  rule:     { width: '100%', height: 1, background: '#2a2d38', marginTop: 32 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '32px 0 14px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#7a7873', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  row:          { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  rowGold:      { background: 'linear-gradient(135deg, rgba(201,168,76,0.07) 0%, #21242e 60%)', border: '1px solid rgba(201,168,76,0.22)', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  rowHighlight: { background: '#252836', border: '1px solid #c9a84c', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  goldStripe:   { position: 'absolute' as const, left: 0, top: 0, bottom: 0, width: 3, background: '#c9a84c', borderRadius: '3px 0 0 3px' },

  rankCell: { width: 32, textAlign: 'center' as const, flexShrink: 0 },
  medal:    { fontSize: 22, lineHeight: '1', display: 'block' },
  rankNum:  { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#7a7873', display: 'block' },
  rankTied: { fontFamily: "'Libre Baskerville', serif", fontSize: 13, fontWeight: 700, color: '#c9a84c', display: 'block' },

  nameBlock: { flex: 1, minWidth: 0 },
  name:      { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, marginBottom: 2 },
  nameSub:   { fontSize: 12, color: '#7a7873' },

  scoreBlock: { textAlign: 'right' as const, flexShrink: 0 },
  score:      { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', lineHeight: '1', marginBottom: 3 },
  scoreSub:   { fontSize: 11, color: '#7a7873' },
  tiedLabel:  { color: '#c9a84c', marginLeft: 4 },

  profileBar: { background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 20, padding: '14px 20px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 },
  avatar:     { width: 34, height: 34, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#c9a84c', overflow: 'hidden' as const },

  card:       { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px 24px', marginBottom: 12 },
  cardRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' as const },
  cardTitle:  { fontSize: 14, fontWeight: 700, color: '#ffffff', marginBottom: 3 },
  cardSub:    { fontSize: 12, color: '#7a7873' },

  btnGold:    { display: 'inline-flex', alignItems: 'center', gap: 8, background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0, textDecoration: 'none' },
  btnOutline: { background: 'none', color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: '4px 0', border: 'none', cursor: 'pointer' },
  btnMore:    { width: '100%', padding: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, color: '#e8e4dd', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", marginTop: 4, marginBottom: 16 },

  separator: { textAlign: 'center' as const, fontSize: 11, color: '#7a7873', letterSpacing: '0.1em', textTransform: 'uppercase' as const, margin: '12px 0 8px', fontWeight: 600 },

  tabRow:     { display: 'flex', borderBottom: '1px solid #2a2d38', marginBottom: 16 },
  tabActive:  { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid #c9a84c', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  tabInactive:{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  tabEmpty:   { padding: '24px 0', textAlign: 'center' as const, fontSize: 13, color: '#7a7873', fontStyle: 'italic' as const },

  empty:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 32 },
  emptyIcon: { fontSize: 44, marginBottom: 16, opacity: 0.5 },
  emptyTitle:{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, color: '#ffffff', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 24 },
  btnLink:   { display: 'inline-block', background: 'transparent', color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 600, padding: '10px 28px', border: '1px solid #2a2d38', borderRadius: 10, textDecoration: 'none' },
}

type BadgeKind = 'krone' | 'pil' | 'flamme' | 'lyn' | 'medalje'

function BadgeCircle({ badge, size = 18 }: { badge: BadgeKind; size?: number }) {
  const bg = '#c9a84c'
  const iconSize = Math.round(size * 0.65)
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none">
        {badge === 'krone'   && <path d="M2 8L4 3L8 6L12 3L14 8H2Z" fill="#1a1c23"/>}
        {badge === 'pil'     && <path d="M8 3L13 10H3L8 3Z" fill="white"/>}
        {badge === 'flamme'  && <path d="M8 2C8 2 12 5 12 8.5C12 11 10 13 8 14C6 13 4 11 4 8.5C4 5 8 2 8 2Z" fill="white"/>}
        {badge === 'lyn'     && <path d="M10 2L5 9H9L6 14L13 6H9L10 2Z" fill="white"/>}
        {badge === 'medalje' && <circle cx="8" cy="8" r="4" fill="white"/>}
      </svg>
    </div>
  )
}

// Felles entry-form fra /api/leaderboard/[id]
type LbEntry = {
  rank: number
  id: string
  userId: string | null
  playerName: string
  correctAnswers: number
  totalQuestions: number
  totalTimeMs: number
  correctStreak: number | null
  isTeam: boolean
  teamSize: number
  leaderDisplayName: string | null
}

function entryToAttempt(e: LbEntry, quizId: string): Attempt {
  return {
    id: e.id,
    quiz_id: quizId,
    player_name: e.playerName,
    is_team: e.isTeam,
    team_size: e.teamSize,
    correct_answers: e.correctAnswers,
    total_questions: e.totalQuestions,
    total_time_ms: e.totalTimeMs,
    correct_streak: e.correctStreak,
    user_id: e.userId,
    completed_at: '',
    leader_display_name: e.leaderDisplayName,
  }
}

const BROWSE_PAGE_SIZE = 20

export default function LeaderboardPage() {
  const params = useParams()
  const quizId = params.id as string
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [profile, setProfile] = useState<{ display_name: string | null, avatar_url: string | null } | null>(null)
  const [isPremiumOverride, setIsPremiumOverride] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [visibleSoloCount, setVisibleSoloCount] = useState(10)
  const [visibleTeamCount, setVisibleTeamCount] = useState(10)
  const [scrollPending, setScrollPending] = useState(false)
  const [savedResult, setSavedResult] = useState<{ correct_answers: number; total_time_ms: number } | null>(null)
  const [friendNames, setFriendNames] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'alle' | 'venner' | 'lag'>('alle')
  const [visibleVennerCount, setVisibleVennerCount] = useState(10)
  const [memberInfoMap, setMemberInfoMap] = useState<Map<string, { member_number: number | null, show_member_number: boolean, avatar_url: string | null, display_name: string | null }>>(new Map())
  const [prevRankMap, setPrevRankMap] = useState<Map<string, number>>(new Map())
  const [mostImprovedName, setMostImprovedName] = useState<string | null>(null)
  const [podiumActive, setPodiumActive] = useState(false)
  const [hasLeagues, setHasLeagues] = useState(false)
  const [activeDuelExists, setActiveDuelExists] = useState(false)
  const [challengeSentSet, setChallengeSentSet] = useState<Set<string>>(new Set())
  const [duelInvolvedSet, setDuelInvolvedSet] = useState<Set<string>>(new Set())
  const [challengeLoadingId, setChallengeLoadingId] = useState<string | null>(null)
  const [challengeError, setChallengeError] = useState<{ rivalId: string; message: string } | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [challengeCopied, setChallengeCopied] = useState(false)
  // Fix 3: store timer ref so it can be cleared on unmount
  const challengeErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  type AnswerDistQuestion = {
    questionId: string
    questionText: string
    correctAnswer: string
    totalAnswers: number
    distribution: { option: string; label: string; count: number; percent: number }[]
  }
  const [answerDist, setAnswerDist] = useState<AnswerDistQuestion[] | null>(null)
  const [answerDistLoading, setAnswerDistLoading] = useState(false)
  const [showAnswerDist, setShowAnswerDist] = useState(false)

  // Server-side totaler + brukerens eksakte plassering (også utenfor topp 50)
  const [soloTotal, setSoloTotal] = useState(0)
  const [teamTotal, setTeamTotal] = useState(0)
  const [serverUserSolo, setServerUserSolo] = useState<RankedAttempt | null>(null)
  const [serverUserTeam, setServerUserTeam] = useState<RankedAttempt | null>(null)

  // Premium browse-modus (paginering + søk) for "Alle"/"Lag"
  const [browseMode, setBrowseMode]               = useState(false)
  const [browsePage, setBrowsePage]               = useState(1)
  const [browseSearchInput, setBrowseSearchInput] = useState('')
  const [browseSearch, setBrowseSearch]           = useState('')
  const [browseData, setBrowseData]   = useState<{ entries: LbEntry[]; totalCount: number; userRank: number | null } | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)

  useEffect(() => {
    async function fetchData() {
      try {
        // Klassisk visning henter topp 50 per rom server-side (rangert via RPC,
        // med JS-fallback). Erstatter tidligere nedlasting av opptil 2000 rader.
        const [{ data: quizData, error: e1 }, soloRes, teamRes] = await Promise.all([
          supabaseData.from('quizzes').select('*').eq('id', quizId).single(),
          fetch(`/api/leaderboard/${quizId}?is_team=false&limit=50`).then(r => r.ok ? r.json() : null),
          fetch(`/api/leaderboard/${quizId}?is_team=true&limit=50`).then(r => r.ok ? r.json() : null),
        ])
        if (e1) throw e1
        setQuiz(quizData)
        const soloRows: LbEntry[] = soloRes?.entries ?? []
        const teamRows: LbEntry[] = teamRes?.entries ?? []
        setSoloTotal(soloRes?.totalCount ?? soloRows.length)
        setTeamTotal(teamRes?.totalCount ?? teamRows.length)
        const attemptsResult: Attempt[] = [
          ...soloRows.map(e => entryToAttempt(e, quizId)),
          ...teamRows.map(e => entryToAttempt(e, quizId)),
        ]
        setAttempts(attemptsResult)

        const userIds = [...new Set(attemptsResult.map((a: Attempt) => a.user_id).filter((id): id is string => !!id))]
        if (userIds.length > 0) {
          const { data: memberProfiles } = await supabaseData
            .from('profiles')
            .select('id, member_number, show_member_number, avatar_url, display_name')
            .in('id', userIds)
          if (memberProfiles) {
            const map = new Map<string, { member_number: number | null, show_member_number: boolean, avatar_url: string | null, display_name: string | null }>()
            for (const p of memberProfiles as { id: string, member_number: number | null, show_member_number: boolean | null, avatar_url: string | null, display_name: string | null }[]) {
              map.set(p.id, { member_number: p.member_number ?? null, show_member_number: p.show_member_number ?? false, avatar_url: p.avatar_url ?? null, display_name: p.display_name ?? null })
            }
            setMemberInfoMap(map)
          }
        }

        // Forrige quiz' rangering for "pil opp"-merket — server-side fordi
        // attempts.user_id ikke lenger er lesbar med anon-nøkkelen.
        try {
          const prevRes = await fetch(`/api/leaderboard/${quizId}/prev-rank`)
          if (prevRes.ok) {
            const { prevRanks } = await prevRes.json() as { prevRanks: Record<string, number> }
            if (prevRanks && Object.keys(prevRanks).length > 0) {
              setPrevRankMap(new Map(Object.entries(prevRanks)))
            }
          }
        } catch { /* Previous quiz data is optional */ }
      } catch (e) {
        console.error('fetchData (leaderboard) feilet:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [quizId])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`qk_result_${quizId}`)
      if (saved) setSavedResult(JSON.parse(saved))
    } catch {}
  }, [quizId])

  const loadSession = useCallback(async () => {
    setAuthLoading(true)
    const sess = await getSession()
    setSession(sess)
    if (sess?.user) {
      // Hent profildata (display_name, avatar) client-side
      const { data: prof, error: profError } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', sess.user.id)
        .maybeSingle()
      if (profError) console.error('[leaderboard] profile fetch error:', profError.code, profError.message)
      setProfile(prof)
      setDisplayName(prof?.display_name ?? sess.user.email?.split('@')[0] ?? null)
      setAvatarUrl(prof?.avatar_url ?? null)

      // Hent premium-status server-side (service role — omgår RLS)
      try {
        const premRes = await fetch('/api/profile/premium-status', {
          headers: { Authorization: `Bearer ${sess.access_token}` },
        })
        if (premRes.ok) {
          const premData = await premRes.json()
          setIsPremiumOverride(premData.isPremium === true)
        }
      } catch (err) { console.error('[leaderboard] premium-status fetch feilet:', err) }

      // Hent brukerens eksakte plassering server-side (også om utenfor topp 50)
      try {
        const [soloMe, teamMe] = await Promise.all([
          fetch(`/api/leaderboard/${quizId}?is_team=false&limit=1`, { headers: { Authorization: `Bearer ${sess.access_token}` } }).then(r => r.ok ? r.json() : null),
          fetch(`/api/leaderboard/${quizId}?is_team=true&limit=1`,  { headers: { Authorization: `Bearer ${sess.access_token}` } }).then(r => r.ok ? r.json() : null),
        ])
        if (soloMe?.userEntry) setServerUserSolo({ ...entryToAttempt(soloMe.userEntry, quizId), rank: soloMe.userEntry.rank, isTied: false })
        if (teamMe?.userEntry) setServerUserTeam({ ...entryToAttempt(teamMe.userEntry, quizId), rank: teamMe.userEntry.rank, isTied: false })
        if (typeof soloMe?.totalCount === 'number') setSoloTotal(soloMe.totalCount)
        if (typeof teamMe?.totalCount === 'number') setTeamTotal(teamMe.totalCount)
      } catch { /* ikke kritisk */ }

      // Hent ligamedlemmer for "Blant venner"-fane
      try {
        const leaguesRes = await fetch('/api/leagues', {
          headers: { Authorization: `Bearer ${sess.access_token}` },
        })
        if (leaguesRes.ok) {
          const leaguesJson = await leaguesRes.json()
          const leagues: { id: string }[] = leaguesJson.leagues ?? []
          setHasLeagues(leagues.length > 0)
          const memberResponses = await Promise.all(
            leagues.map(l =>
              fetch(`/api/leagues/${l.id}`, {
                headers: { Authorization: `Bearer ${sess.access_token}` },
              }).then(r => r.ok ? r.json() : null)
            )
          )
          const userIds = new Set<string>()
          for (const res of memberResponses) {
            for (const m of (res?.members ?? []) as { user_id: string }[]) {
              userIds.add(m.user_id)
            }
          }
          if (userIds.size > 0) {
            const { data: friendProfiles } = await supabaseData
              .from('profiles')
              .select('display_name')
              .in('id', [...userIds])
            setFriendNames(new Set(
              (friendProfiles ?? [])
                .map((p: { display_name: string | null }) => p.display_name)
                .filter((n): n is string => !!n)
            ))
          }
        }
      } catch { /* ikke kritisk */ }

      // Hent duell-status for "Utfordre"-knapp i leaderboard-rader
      try {
        const rivalRes = await fetch('/api/rivalries/my', {
          headers: { Authorization: `Bearer ${sess.access_token}` },
        })
        if (rivalRes.ok) {
          const rivalJson = await rivalRes.json()
          const rows: { status: string; isChallenger: boolean; opponentId: string; isExpired: boolean }[] = rivalJson.rivalries ?? []
          // Only non-expired active/pending duels are "engagements" that block new challenges.
          // Fix 4: declined duels must not block — challenger is free to start a new duel.
          const engagedRows = rows.filter(r => !r.isExpired && r.status !== 'declined')
          setActiveDuelExists(engagedRows.length > 0)
          // Build a Set of ALL opponent IDs in active engagements (both challenger and rival sides)
          setDuelInvolvedSet(new Set(engagedRows.map(r => r.opponentId)))
          // Still track outgoing-pending separately to show "Sendt" label
          setChallengeSentSet(new Set(
            engagedRows.filter(r => r.status === 'pending' && r.isChallenger).map(r => r.opponentId)
          ))
        }
      } catch { /* ikke kritisk */ }
    }
    setAuthLoading(false)
  }, [])

  useEffect(() => {
    loadSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadSession()
    })
    return () => subscription.unsubscribe()
  }, [loadSession])

  // Re-sjekk premium-status når siden blir synlig igjen (håndterer fanebytte
  // og Next.js router-cache som gjenbruker gammel React-tilstand etter navigasjon)
  useEffect(() => {
    const handleVisible = async () => {
      if (document.visibilityState !== 'visible') return
      const sess = await getSession()
      if (!sess?.access_token) return
      try {
        const res = await fetch('/api/profile/premium-status', {
          headers: { Authorization: `Bearer ${sess.access_token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setIsPremiumOverride(data.isPremium === true)
        }
      } catch (err) { console.error('[leaderboard] visibilitychange premium-status feilet:', err) }
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [])

  // Fix 3: clean up challengeError timer on unmount to prevent state update on unmounted component
  useEffect(() => {
    return () => {
      if (challengeErrorTimerRef.current) clearTimeout(challengeErrorTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (prevRankMap.size === 0 || attempts.length === 0) return
    const currentRanked = rankAttempts(attempts.filter(a => !a.is_team))
    let best: { name: string; improvement: number } | null = null
    for (const a of currentRanked) {
      const prevRank = prevRankMap.get(a.user_id ?? a.player_name)
      if (prevRank !== undefined) {
        const improvement = prevRank - a.rank
        if (improvement > 0 && (!best || improvement > best.improvement)) {
          best = { name: a.player_name, improvement }
        }
      }
    }
    setMostImprovedName(best?.name ?? null)
  }, [prevRankMap, attempts])

  useEffect(() => {
    if (!scrollPending) return
    const el = document.getElementById('user-row')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setScrollPending(false)
    }
  }, [scrollPending])

  // Nullstill browse-modus ved fanebytte
  useEffect(() => {
    setBrowseMode(false)
    setBrowsePage(1)
    setBrowseSearchInput('')
    setBrowseSearch('')
    setBrowseData(null)
  }, [activeTab])

  // Debounce søkefelt → browseSearch. Tomt søk på side 1 = tilbake til klassisk.
  useEffect(() => {
    const t = setTimeout(() => {
      const v = browseSearchInput.trim()
      setBrowseSearch(v)
      setBrowsePage(1)
      if (v !== '') setBrowseMode(true)
      else if (browsePage === 1) setBrowseMode(false)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseSearchInput])

  // Hent browse-data (Premium paginering/søk) for "Alle"/"Lag"
  useEffect(() => {
    if (!browseMode) return
    if (activeTab !== 'alle' && activeTab !== 'lag') return
    let cancelled = false
    setBrowseLoading(true)
    const isTeamRoom = activeTab === 'lag'
    const headers: Record<string, string> = {}
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    let url = `/api/leaderboard/${quizId}?is_team=${isTeamRoom}&page=${browsePage}`
    if (browseSearch) url += `&search=${encodeURIComponent(browseSearch)}`
    fetch(url, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled) setBrowseData(j ? { entries: j.entries ?? [], totalCount: j.totalCount ?? 0, userRank: j.userRank ?? null } : null) })
      .catch(() => { if (!cancelled) setBrowseData(null) })
      .finally(() => { if (!cancelled) setBrowseLoading(false) })
    return () => { cancelled = true }
  }, [browseMode, activeTab, browsePage, browseSearch, quizId, session])

  // Activate podium animation when quiz is closed and data is loaded
  useEffect(() => {
    if (!quiz || loading) return
    const closed = new Date(quiz.closes_at) < new Date()
    if (closed && attempts.length > 0) {
      const t = setTimeout(() => setPodiumActive(true), 50)
      return () => clearTimeout(t)
    }
  }, [quiz, loading, attempts])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch {}
    setSession(null)
    setDisplayName(null)
    setAvatarUrl(null)
  }

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
        // inline error instead of alert()
        const json = await res.json().catch(() => ({}))
        const msg = json.error ?? 'Noe gikk galt.'
        setChallengeError({ rivalId, message: msg })
        // Fix 3: store timer in ref so it can be cancelled on unmount
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

  const isPremium = isPremiumOverride

  const isOpen = (q: Quiz) => {
    const now = new Date()
    return new Date(q.opens_at) <= now && new Date(q.closes_at) >= now
  }

  const formatTime = (ms: number) => {
    const sec = Math.floor(ms / 1000)
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#1a1c23', padding: '40px 20px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonCard rows={2} showHeader style={{ height: 110 }} />
        <SkeletonCard rows={10} showHeader />
      </div>
    </div>
  )

  if (!quiz) return (
    <div style={s.centered}><p style={s.centeredText}>Fant ikke quizen.</p></div>
  )

  if (!quiz.show_leaderboard) return (
    <div style={{ ...s.centered, flexDirection: 'column', gap: 16 }}>
      <p style={s.centeredText}>Ukens resultater er ikke aktivert for denne quizen.</p>
      <Link href="/" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>← Tilbake til forsiden</Link>
    </div>
  )

  // Beregn attempts og brukerens rad FØR hasPlayed/isHidden — hasPlayed trenger userAttempt
  const soloAttempts = rankAttempts(attempts.filter(a => !a.is_team))
  const teamAttempts = rankAttempts(attempts.filter(a => a.is_team))
  const friendAttempts = rankAttempts(attempts.filter(a => !a.is_team && friendNames.has(a.player_name)))
  const showVennerTab = !!session && friendAttempts.length > 0
  const totalCount = soloTotal + teamTotal

  const currentUserId = session?.user?.id ?? null
  // Finn i den lastede topp-50, ellers fall tilbake til server-beregnet plassering
  const userSoloAttempt = (currentUserId
    ? soloAttempts.find(a => a.user_id === currentUserId) ?? null
    : displayName ? soloAttempts.find(a => a.player_name === displayName) ?? null : null)
    ?? serverUserSolo
  const userTeamAttempt = (currentUserId
    ? teamAttempts.find(a => a.user_id === currentUserId) ?? null
    : displayName ? teamAttempts.find(a => a.player_name === displayName) ?? null : null)
    ?? serverUserTeam
  const userAttempt = userSoloAttempt ?? userTeamAttempt

  // hasPlayed: sjekk BÅDE localStorage (savedResult) OG at forsøket finnes i leaderboard-data
  // Dette håndterer tilfellet der bruker spilte på annen enhet (savedResult = null)
  const hasPlayed = !!savedResult || !!userAttempt
  // Only lift the hide for Premium users who have played — free users still get placement card treatment
  const isHidden = quiz.hide_leaderboard_until_closed && isOpen(quiz) && !(isPremium && hasPlayed)

  function handleGoToMyPlacement() {
    if (!userAttempt) return
    if (userSoloAttempt && userAttempt.rank > visibleSoloCount) setVisibleSoloCount(userAttempt.rank + 5)
    if (userTeamAttempt && !userSoloAttempt && userAttempt.rank > visibleTeamCount) setVisibleTeamCount(userAttempt.rank + 5)
    setScrollPending(true)
  }

  const fastestSoloName = soloAttempts.length > 0
    ? soloAttempts.reduce((f, a) => a.total_time_ms < f.total_time_ms ? a : f).player_name
    : null

  const renderRow = (attempt: RankedAttempt, isUser: boolean, extraClass?: string, showLiveNote?: boolean) => {
    const isFirst = attempt.rank === 1 && !attempt.isTied
    const rowStyle = isUser ? s.rowHighlight : isFirst ? s.rowGold : s.row

    const avatarUrl = attempt.user_id ? (memberInfoMap.get(attempt.user_id)?.avatar_url ?? null) : null
    const shownName = attempt.user_id
      ? (memberInfoMap.get(attempt.user_id)?.display_name ?? attempt.player_name)
      : attempt.player_name
    const initial = shownName[0]?.toUpperCase() ?? '?'

    let badge: BadgeKind | null = null
    if (attempt.rank === 1) badge = 'krone'
    else if (attempt.player_name === mostImprovedName) badge = 'pil'
    else if ((attempt.correct_streak ?? 0) >= 3) badge = 'flamme'
    else if (attempt.player_name === fastestSoloName) badge = 'lyn'
    else if (attempt.rank <= 3) badge = 'medalje'

    return (
      <Fragment key={attempt.id}>
        <div id={isUser ? 'user-row' : undefined} style={rowStyle} className={extraClass}>
          {isFirst && <div style={s.goldStripe} />}
          <div style={s.rankCell}>
            {attempt.isTied
              ? <span style={s.rankTied}>{attempt.rank}=</span>
              : attempt.rank <= 3
                ? <span style={s.medal}>{getMedal(attempt.rank)}</span>
                : <span style={s.rankNum}>{attempt.rank}</span>
            }
          </div>
          <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" style={{ borderRadius: '50%', objectFit: 'cover', width: 40, height: 40, display: 'block' }} />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(201,168,76,0.10)', border: '1.5px solid rgba(201,168,76,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#c9a84c' }}>
                {initial}
              </div>
            )}
            {badge && (
              <div style={{ position: 'absolute', bottom: -1, right: -1, border: '2px solid #1a1c23', borderRadius: '50%' }}>
                <BadgeCircle badge={badge} />
              </div>
            )}
          </div>
          <div style={s.nameBlock}>
            {attempt.user_id && memberInfoMap.get(attempt.user_id)?.show_member_number && memberInfoMap.get(attempt.user_id)?.member_number != null && (
              <p style={{ fontSize: 11, color: '#7a7873', marginBottom: 2 }}>
                {'#' + String(memberInfoMap.get(attempt.user_id)!.member_number).padStart(3, '0')}
              </p>
            )}
            <p style={s.name}>
              {shownName}
              {!attempt.user_id && <span style={{ fontSize: 12, color: '#7a7873', fontWeight: 400, marginLeft: 6 }}>(guest)</span>}
            </p>
            <p style={s.nameSub}>
              {attempt.is_team && <span style={{ marginRight: 6 }}>Lag · {attempt.team_size} stk ·</span>}
              ⏱ {formatTime(attempt.total_time_ms)}
            </p>
            {attempt.is_team && attempt.leader_display_name && (
              <p style={{ fontSize: 12, color: '#e8e4dd', marginTop: 2 }}>
                Lagleder: {attempt.leader_display_name}
              </p>
            )}
          </div>
          <div style={s.scoreBlock}>
            <p style={s.score}>{attempt.correct_answers}/{attempt.total_questions}</p>
            <p style={s.scoreSub}>
              {formatTime(attempt.total_time_ms)}
              {attempt.isTied && <span style={s.tiedLabel}>delt</span>}
            </p>
          </div>
          {!isUser && isPremium && !attempt.is_team && attempt.user_id && (() => {
            // Fix 4: hide for all users already involved in any duel with me (both sides)
            const involved = duelInvolvedSet.has(attempt.user_id)
            const sent     = challengeSentSet.has(attempt.user_id)
            const isLoading = challengeLoadingId === attempt.user_id
            if (involved && sent) {
              // Outgoing pending: show "Sendt"
              return (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#c9a84c', letterSpacing: '0.06em', flexShrink: 0 }}>
                  Sendt
                </span>
              )
            }
            if (involved) {
              // Already in a duel relationship (incoming/active) — hide button silently
              return null
            }
            if (activeDuelExists) {
              // Has a different active duel — block all other challenges
              return null
            }
            return (
              <button
                onClick={() => handleChallenge(attempt.user_id!)}
                disabled={isLoading}
                style={{
                  background: 'none',
                  border: '1px solid rgba(201,168,76,0.35)',
                  color: '#c9a84c',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 8,
                  cursor: isLoading ? 'default' : 'pointer',
                  fontFamily: "'Instrument Sans', sans-serif",
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                {isLoading ? '…' : 'Utfordre'}
              </button>
            )
          })()}
        </div>
        {/* Fix 5: inline feilmelding under raden i 3 sekunder */}
        {attempt.user_id && challengeError?.rivalId === attempt.user_id && (
          <p style={{ fontSize: 13, color: '#E24B4A', margin: '-4px 0 8px 20px' }}>
            {challengeError.message}
          </p>
        )}
        {showLiveNote && (
          <p style={{ fontSize: 12, color: '#e8e4dd', textAlign: 'center', margin: '-4px 0 8px' }}>
            {soloTotal} spillere har spilt så langt — oppdateres gjennom dagen
          </p>
        )}
      </Fragment>
    )
  }

  const renderSection = (ranked: RankedAttempt[], label: string, visibleCount: number, onShowMore: () => void, isPodium = false) => {
    if (ranked.length === 0) return null
    const visible = ranked.slice(0, visibleCount)
    const userInSection = currentUserId
      ? ranked.find(a => a.user_id === currentUserId) ?? null
      : displayName ? ranked.find(a => a.player_name === displayName) ?? null : null
    const userOutsideVisible = userInSection && userInSection.rank > visibleCount
    const remaining = ranked.length - visibleCount

    const podiumClass = (rank: number): string | undefined => {
      if (!isPodium || !podiumActive) return undefined
      if (rank === 1) return 'podium-row-1'
      if (rank === 2) return 'podium-row-2'
      if (rank === 3) return 'podium-row-3'
      return 'podium-rest'
    }

    return (
      <div key={label}>
        <div style={s.sectionHeader}>
          <span style={s.sectionText}>{label}</span>
          <div style={s.sectionLine} />
          <span style={s.sectionCount}>{ranked.length}</span>
        </div>
        {visible.map(attempt => {
          const isUserRow = isPremium && (currentUserId ? attempt.user_id === currentUserId : attempt.player_name === displayName)
          return renderRow(attempt, isUserRow, podiumClass(attempt.rank), isUserRow && !isClosed)
        })}
        {userOutsideVisible && isPremium && (
          <>
            <p style={s.separator}>— Din plassering —</p>
            {renderRow(userInSection, true, undefined, !isClosed)}
          </>
        )}
        {remaining > 0 && (
          <button style={s.btnMore} onClick={onShowMore}>
            Vis {Math.min(10, remaining)} til
          </button>
        )}
      </div>
    )
  }

  // ── Premium browse-modus (paginering/søk) for "Alle"/"Lag" ────────────────
  const roomTotal    = activeTab === 'lag' ? teamTotal : soloTotal
  const roomUserRank = activeTab === 'lag' ? (userTeamAttempt?.rank ?? null) : (userSoloAttempt?.rank ?? null)
  const userInBrowse = !!(currentUserId && browseData?.entries.some(e => e.userId === currentUserId))
  const browseSearching = browseMode && browseSearch.trim() !== ''
  const showBrowseControls = isPremium && (activeTab === 'alle' || activeTab === 'lag') && (roomTotal > 10 || browseMode)
  const showJumpToMeBrowse = showBrowseControls && roomUserRank != null && !userInBrowse && !browseSearching

  function browsePageWindow(current: number, total: number): (number | 'gap')[] {
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

  function goToMyPlacementBrowse() {
    if (roomUserRank == null) return
    setBrowseMode(true)
    setBrowsePage(Math.max(1, Math.ceil(roomUserRank / BROWSE_PAGE_SIZE)))
    setScrollPending(true)
  }

  function renderBrowseControls() {
    if (!showBrowseControls) return null
    const tc = browseData?.totalCount ?? 0
    return (
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          value={browseSearchInput}
          onChange={e => setBrowseSearchInput(e.target.value)}
          placeholder="Søk etter navn…"
          style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none' }}
        />
        {showJumpToMeBrowse && (
          <button
            onClick={goToMyPlacementBrowse}
            style={{ marginTop: 10, background: 'transparent', color: '#e8e4dd', border: '1px solid #e8e4dd', borderRadius: 10, padding: '10px 28px', fontSize: 14, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', width: 'auto' }}
          >
            Gå til min plassering (#{roomUserRank})
          </button>
        )}
        {browseSearching && (
          <p style={{ fontSize: 12, color: '#7a7873', marginTop: 8 }}>
            {tc === 0
              ? `Ingen treff på «${browseSearch}».`
              : tc > BROWSE_PAGE_SIZE
                ? `Viser de ${BROWSE_PAGE_SIZE} første av ${tc} treff. Forsøk et mer spesifikt søk.`
                : `${tc} treff.`}
          </p>
        )}
      </div>
    )
  }

  function renderBrowseRow(e: LbEntry) {
    const isSelf = currentUserId != null && e.userId === currentUserId
    const rowStyle = isSelf ? s.rowHighlight : s.row
    const initial = (e.playerName?.[0] ?? '?').toUpperCase()
    const avatarUrl = e.userId ? (memberInfoMap.get(e.userId)?.avatar_url ?? null) : null
    const shownName = e.userId ? (memberInfoMap.get(e.userId)?.display_name ?? e.playerName) : e.playerName
    return (
      <div key={e.id} id={isSelf ? 'user-row' : undefined} style={rowStyle}>
        {isSelf && <div style={s.goldStripe} />}
        <div style={s.rankCell}><span style={s.rankNum}>{e.rank}</span></div>
        <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
          {avatarUrl
            ? <img src={avatarUrl} alt="" style={{ borderRadius: '50%', objectFit: 'cover', width: 40, height: 40, display: 'block' }} />
            : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(201,168,76,0.10)', border: '1.5px solid rgba(201,168,76,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#c9a84c' }}>{initial}</div>
          }
        </div>
        <div style={s.nameBlock}>
          <p style={s.name}>
            {shownName}
            {!e.userId && <span style={{ fontSize: 12, color: '#7a7873', fontWeight: 400, marginLeft: 6 }}>(guest)</span>}
          </p>
          <p style={s.nameSub}>
            {e.isTeam && <span style={{ marginRight: 6 }}>Lag · {e.teamSize} stk ·</span>}
            ⏱ {formatTime(e.totalTimeMs)}
          </p>
        </div>
        <div style={s.scoreBlock}>
          <p style={s.score}>{e.correctAnswers}/{e.totalQuestions}</p>
          <p style={s.scoreSub}>{formatTime(e.totalTimeMs)}</p>
        </div>
      </div>
    )
  }

  function renderBrowseList() {
    if (browseLoading && !browseData) {
      return <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>Laster…</p>
    }
    const entries = browseData?.entries ?? []
    if (entries.length === 0) {
      return <p style={s.tabEmpty}>{browseSearching ? `Ingen treff på «${browseSearch}».` : 'Ingen resultater.'}</p>
    }
    return (
      <>
        <div style={s.sectionHeader}>
          <span style={s.sectionText}>{activeTab === 'lag' ? 'Lag' : 'Enkeltpersoner'}</span>
          <div style={s.sectionLine} />
          <span style={s.sectionCount}>{browseData?.totalCount ?? entries.length}</span>
        </div>
        {entries.map(renderBrowseRow)}
      </>
    )
  }

  function renderBrowsePagination() {
    if (!showBrowseControls || browseSearching) return null
    const totalPages = Math.max(1, Math.ceil(roomTotal / BROWSE_PAGE_SIZE))
    if (totalPages <= 1) return null
    if (!browseMode && roomTotal <= 50) return null   // klassisk "vis til" dekker ≤50
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 16 }}>
        {browsePageWindow(browsePage, totalPages).map((p, i) =>
          p === 'gap'
            ? <span key={`g${i}`} style={{ color: '#7a7873', padding: '6px 4px', fontSize: 12 }}>…</span>
            : <button
                key={p}
                onClick={() => { setBrowsePage(p); setBrowseMode(true) }}
                style={{ background: p === browsePage ? 'rgba(201,168,76,0.12)' : 'transparent', border: `1px solid ${p === browsePage ? '#c9a84c' : '#2a2d38'}`, color: p === browsePage ? '#c9a84c' : '#e8e4dd', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const }}
              >
                {`${(p - 1) * BROWSE_PAGE_SIZE + 1}–${Math.min(p * BROWSE_PAGE_SIZE, roomTotal)}`}
              </button>
        )}
      </div>
    )
  }

  const isClosed = quiz ? new Date(quiz.closes_at) < new Date() : false

  return (
    <>
      <style>{podiumStyles}</style>
      <AuthModal open={showModal} onClose={() => setShowModal(false)} />
      <div style={s.wrap}>
        <div style={s.page}>

          <header style={s.header}>
            <p style={s.eyebrow}>Quizkanonen</p>
            <h1 style={s.title}>Quiz<em style={s.titleEm}>kanonen</em></h1>
            <p style={s.subtitle}>{quiz.title}</p>
            <div style={s.rule} />
          </header>

          {/* Profile bar */}
          {!authLoading && session && (() => {
            const barName =
              (session.user.id ? memberInfoMap.get(session.user.id)?.display_name : null)
              ?? profile?.display_name
              ?? displayName
            return (
              <div style={s.profileBar}>
                <div style={s.avatar}>
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" width={34} height={34} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (barName?.[0]?.toUpperCase() ?? '?')
                  }
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>{barName}</p>
                  <p style={{ fontSize: 11, color: '#7a7873', marginTop: 1 }}>Innlogget</p>
                </div>
                <button onClick={handleSignOut} style={s.btnOutline}>Logg ut</button>
              </div>
            )
          })()}

          {/* Hero result card — vises når bruker har spilt */}
          {(hasPlayed || userAttempt) && (() => {
            const correctAnswers = userAttempt?.correct_answers ?? savedResult?.correct_answers ?? null
            const totalQ = userAttempt?.total_questions ?? null
            const timeMs = userAttempt?.total_time_ms ?? savedResult?.total_time_ms ?? null
            const rank = isPremium && userAttempt ? userAttempt.rank : null
            const streak = userAttempt?.correct_streak ?? null
            const scorePct = correctAnswers != null && totalQ != null ? Math.round(correctAnswers / totalQ * 100) : null
            const hasStats = rank != null || timeMs != null || scorePct != null || (streak != null && streak > 0)

            return (
              <div style={{ background: '#21242e', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 20, marginBottom: 12 }}>
                {/* qk-lb-result-wrap: kolonne på mobil, rad på desktop */}
                <div className="qk-lb-result-wrap" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>

                  {/* Score-seksjon */}
                  {correctAnswers != null && (
                    <div>
                      <p style={{ fontFamily: "'Libre Baskerville', serif", fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 3 }}>
                        <span className="qk-lb-hero-score" style={{ fontSize: 52 }}>{correctAnswers}</span>
                        {totalQ != null && <span className="qk-lb-score-label" style={{ fontSize: 22, color: '#7a7873', fontWeight: 400 }}> av {totalQ}</span>}
                      </p>
                      <p style={{ fontSize: 11, color: '#7a7873', letterSpacing: '0.12em', textTransform: 'uppercase' as const, fontWeight: 600 }}>riktige svar</p>
                    </div>
                  )}

                  {/* Meta-rad: plassering + statistikk */}
                  {hasStats && (
                    <div className="qk-lb-meta-row" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const, justifyContent: 'center' }}>
                      {rank != null && (
                        <span style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#c9a84c', whiteSpace: 'nowrap' as const }}>
                          Plass {rank} av {totalCount}
                        </span>
                      )}
                      {timeMs != null && (
                        <div style={{ textAlign: 'center' as const }}>
                          <p style={{ fontSize: 15, fontWeight: 700, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif" }}>{formatTime(timeMs)}</p>
                          <p style={{ fontSize: 10, color: '#7a7873', marginTop: 1, textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 600 }}>Tid</p>
                        </div>
                      )}
                      {scorePct != null && (
                        <div style={{ textAlign: 'center' as const }}>
                          <p style={{ fontSize: 15, fontWeight: 700, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif" }}>{scorePct}%</p>
                          <p style={{ fontSize: 10, color: '#7a7873', marginTop: 1, textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 600 }}>Score</p>
                        </div>
                      )}
                      {streak != null && streak > 0 && (
                        <div style={{ textAlign: 'center' as const }}>
                          <p style={{ fontSize: 15, fontWeight: 700, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif" }}>{streak}</p>
                          <p style={{ fontSize: 10, color: '#7a7873', marginTop: 1, textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 600 }}>Streak</p>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
            )
          })()}

          {/* Del-knapp — innloggede brukere som har spilt */}
          {!authLoading && session && hasPlayed && (() => {
            const shareCorrect = userAttempt?.correct_answers ?? savedResult?.correct_answers ?? null
            const shareTotalQ  = userAttempt?.total_questions ?? null
            const shareRank    = isPremium && userAttempt ? userAttempt.rank : null
            if (shareCorrect == null) return null
            const shareText = shareRank != null && shareTotalQ != null
              ? `Jeg fikk ${shareCorrect}/${shareTotalQ} og havnet på ${shareRank}. av ${totalCount} på Quizkanonen! 🎯`
              : shareTotalQ != null
              ? `Jeg fikk ${shareCorrect}/${shareTotalQ} på Quizkanonen! 🎯`
              : `Jeg fikk ${shareCorrect} riktige på Quizkanonen! 🎯`

            async function handleShare() {
              if (navigator.share) {
                await navigator.share({ text: shareText }).catch(() => {/* avbrutt */})
              } else {
                await navigator.clipboard.writeText(shareText).catch(() => {})
                setShareCopied(true)
                setTimeout(() => setShareCopied(false), 2500)
              }
            }

            const challengeUrl = `https://www.quizkanonen.no/utfordring?fra=${encodeURIComponent(displayName ?? 'En spiller')}&quiz=${quiz?.id ?? ''}`
            const challengeText = `${displayName ?? 'En spiller'} utfordrer deg på ukens Quizkanonen! Kan du slå meg? 🎯`

            async function handleChallenge() {
              if (navigator.share) {
                await navigator.share({ text: challengeText, url: challengeUrl }).catch(() => {/* avbrutt */})
              } else {
                await navigator.clipboard.writeText(`${challengeText}\n${challengeUrl}`).catch(() => {})
                setChallengeCopied(true)
                setTimeout(() => setChallengeCopied(false), 2500)
              }
            }

            return (
              <div style={{ textAlign: 'center', marginBottom: 12, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleShare}
                  style={{
                    background: 'transparent',
                    border: '1px solid #2a2d38',
                    color: shareCopied ? '#4ade80' : '#e8e4dd',
                    fontFamily: "'Instrument Sans', sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '10px 24px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  {shareCopied ? 'Kopiert!' : 'Del resultatet ditt'}
                </button>
                <button
                  onClick={handleChallenge}
                  style={{
                    background: 'transparent',
                    border: '1px solid #2a2d38',
                    color: challengeCopied ? '#4ade80' : '#e8e4dd',
                    fontFamily: "'Instrument Sans', sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '10px 24px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  {challengeCopied ? 'Lenke kopiert!' : 'Utfordre en venn'}
                </button>
              </div>
            )
          })()}

          {/* Placement card — kun for ikke-innloggede og kun hvis det finnes resultater */}
          {!authLoading && !session && totalCount > 0 && (() => {
            // Vis kun plasserings-estimat hvis gjesten faktisk har spilt (har et lagret forsøk).
            // Uten et forsøk er "plass 1 og 9" villedende — vis en nøytral CTA i stedet.
            let title: string
            let sub: string
            if (savedResult) {
              const { correct_answers, total_time_ms } = savedResult
              const allRanked = [...soloAttempts, ...teamAttempts]
              const better = allRanked.filter(a =>
                a.correct_answers > correct_answers ||
                (a.correct_answers === correct_answers && a.total_time_ms < total_time_ms)
              ).length
              const est = better + 1
              const tierStart = Math.floor((est - 1) / 10) * 10 + 1
              const rangeX = Math.max(1, tierStart)
              const rangeY = Math.min(totalCount, tierStart + 9)
              title = `Du er et sted mellom plass ${rangeX} og ${rangeY}`
              sub = 'Logg inn for å se nøyaktig plassering'
            } else {
              title = 'Logg inn og spill quizen'
              sub = 'Se hvor du havner i ukens resultater.'
            }
            return (
              <div style={s.card}>
                <div style={s.cardRow}>
                  <div>
                    <p style={s.cardTitle}>{title}</p>
                    <p style={s.cardSub}>{sub}</p>
                  </div>
                  <button onClick={() => setShowModal(true)} style={s.btnGold}>
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
                      <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
                      <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
                      <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
                    </svg>
                    Logg inn med Google
                  </button>
                </div>
              </div>
            )
          })()}

          {/* Placement card for free logged-in user who has played while quiz is open */}
          {!authLoading && session && !isPremium && !isClosed && hasPlayed && totalCount > 0 && (() => {
            let rangeX = 1
            let rangeY = Math.min(10, totalCount)
            // Foretrekk server-beregnet plassering; fall tilbake til lokalt estimat
            const estRank = userSoloAttempt?.rank ?? userTeamAttempt?.rank ?? null
            if (estRank != null) {
              const tierStart = Math.floor((estRank - 1) / 10) * 10 + 1
              rangeX = Math.max(1, tierStart)
              rangeY = Math.min(totalCount, tierStart + 9)
            } else if (savedResult) {
              const { correct_answers, total_time_ms } = savedResult
              const allRanked = [...soloAttempts, ...teamAttempts]
              const better = allRanked.filter(a =>
                a.correct_answers > correct_answers ||
                (a.correct_answers === correct_answers && a.total_time_ms < total_time_ms)
              ).length
              const est = better + 1
              const tierStart = Math.floor((est - 1) / 10) * 10 + 1
              rangeX = Math.max(1, tierStart)
              rangeY = Math.min(totalCount, tierStart + 9)
            }
            return (
              <div style={s.card}>
                <p style={s.cardTitle}>Du er et sted mellom plass {rangeX} og {rangeY}</p>
                <p style={{ fontSize: 13, color: '#7a7873', marginTop: 4 }}>
                  Se nøyaktig plassering —{' '}
                  <a href="/premium" style={{ color: '#e8e4dd', textDecoration: 'none' }}>
                    få Premium
                  </a>
                </p>
              </div>
            )
          })()}

          {isHidden ? (
            // Vis ingenting mens auth loader (forhindrer at premium-bruker ser låse-skjerm)
            // Vis låse-skjerm kun når vi vet sikkert at bruker ikke har spilt
            (!authLoading && !hasPlayed) ? (
              <div style={s.empty}>
                <div style={{ ...s.emptyIcon, fontSize: undefined }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5">
                    <rect x="3" y="11" width="18" height="11" rx="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
                <p style={s.emptyTitle}>Spill quizen for å se ukens resultater</p>
                <p style={s.emptySub}>
                  Ukens resultater er kun synlig for de som har spilt.<br />
                  Publiseres for alle når quizen stenger.
                </p>
                <Link href={`/quiz/${quizId}`} style={s.btnLink}>Spill quizen →</Link>
              </div>
            ) : null
          ) : attempts.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7a7873" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <p style={s.emptyTitle}>Ingen resultater ennå</p>
              <p style={s.emptySub}>Vær den første til å fullføre denne quizen.</p>
              <Link href={`/quiz/${quizId}`} style={s.btnLink}>Spill quizen →</Link>
            </div>
          ) : (
            <>
              <div style={s.tabRow}>
                <button
                  style={activeTab === 'alle' ? s.tabActive : s.tabInactive}
                  onClick={() => setActiveTab('alle')}
                >
                  Alle
                </button>
                {showVennerTab && (
                  <button
                    style={activeTab === 'venner' ? s.tabActive : s.tabInactive}
                    onClick={() => setActiveTab('venner')}
                  >
                    Blant venner
                  </button>
                )}
                <button
                  style={activeTab === 'lag' ? s.tabActive : s.tabInactive}
                  onClick={() => setActiveTab('lag')}
                >
                  Lag
                </button>
              </div>

              {activeTab === 'alle' && (
                <>
                  {renderBrowseControls()}
                  {browseMode
                    ? renderBrowseList()
                    : renderSection(soloAttempts, 'Enkeltpersoner', visibleSoloCount, () => setVisibleSoloCount(c => c + 10), isClosed)}
                  {renderBrowsePagination()}
                </>
              )}

              {activeTab === 'venner' && (
                friendAttempts.length > 0
                  ? renderSection(friendAttempts, 'Blant venner', visibleVennerCount, () => setVisibleVennerCount(c => c + 10))
                  : <p style={s.tabEmpty}>Ingen ligavenner har spilt denne quizen ennå</p>
              )}

              {activeTab === 'lag' && (
                <>
                  {renderBrowseControls()}
                  {browseMode
                    ? renderBrowseList()
                    : renderSection(teamAttempts, 'Lag', visibleTeamCount, () => setVisibleTeamCount(c => c + 10))}
                  {renderBrowsePagination()}
                </>
              )}

              {/* Badge legend */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 20, paddingTop: 16, borderTop: '1px solid #2a2d38' }}>
                {([
                  { badge: 'krone', label: 'Leder' },
                  { badge: 'pil', label: 'Størst fremgang' },
                  { badge: 'flamme', label: 'Streak 3+' },
                  { badge: 'lyn', label: 'Raskest' },
                  { badge: 'medalje', label: 'Topp 3' },
                ] as { badge: BadgeKind; label: string }[]).map(({ badge, label }) => (
                  <span key={badge} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#e8e4dd' }}>
                    <BadgeCircle badge={badge} size={14} />
                    {label}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Liga CTA for innloggede uten ligaer */}
          {!authLoading && session && !hasLeagues && (
            <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13 }}>
              Vil du konkurrere mot vennene dine?{' '}
              <a href="/liga" style={{ color: '#e8e4dd', textDecoration: 'none' }}>Opprett en privatliga →</a>
            </p>
          )}

          {/* Svarfordeling — kun etter at quiz er stengt */}
          {isClosed && (
            <div style={{ marginTop: 32 }}>
              <div style={s.sectionHeader}>
                <span style={s.sectionText}>Svarfordeling</span>
                <div style={s.sectionLine} />
                <button
                  onClick={async () => {
                    if (!showAnswerDist && !answerDist) {
                      setAnswerDistLoading(true)
                      try {
                        const res = await fetch(`/api/quiz/${quizId}/answer-distribution`)
                        if (res.ok) {
                          const d = await res.json()
                          setAnswerDist(d.questions ?? [])
                        }
                      } catch { /* stille */ } finally {
                        setAnswerDistLoading(false)
                      }
                    }
                    setShowAnswerDist(v => !v)
                  }}
                  style={{ background: 'none', border: '1px solid #2a2d38', borderRadius: 8, padding: '4px 12px', fontSize: 11, fontWeight: 600, color: '#e8e4dd', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
                >
                  {showAnswerDist ? 'Skjul' : 'Vis'}
                </button>
              </div>

              {showAnswerDist && (
                answerDistLoading
                  ? <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>Laster…</p>
                  : answerDist && answerDist.length > 0
                    ? answerDist.map((q, qi) => (
                        <div key={q.questionId} style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px 22px', marginBottom: 10 }}>
                          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 8 }}>
                            Spørsmål {qi + 1}
                          </p>
                          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 15, fontWeight: 700, color: '#ffffff', marginBottom: 16, lineHeight: 1.4 }}>
                            {q.questionText}
                          </p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {q.distribution.map(d => {
                              const isCorrect = d.option === q.correctAnswer
                              return (
                                <div key={d.option}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: isCorrect ? '#c9a84c' : '#7a7873', width: 14, flexShrink: 0 }}>{d.option}</span>
                                    <span style={{ fontSize: 13, color: isCorrect ? '#e8e4dd' : '#7a7873', flex: 1, lineHeight: 1.3 }}>{d.label}</span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: isCorrect ? '#c9a84c' : '#7a7873', flexShrink: 0 }}>{d.percent}%</span>
                                  </div>
                                  <div style={{ height: 6, background: '#2a2d38', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${d.percent}%`, background: isCorrect ? '#c9a84c' : '#3a3d48', borderRadius: 3, transition: 'width 0.4s ease' }} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          {q.totalAnswers > 0 && (
                            <p style={{ fontSize: 11, color: '#7a7873', marginTop: 12, textAlign: 'right' }}>
                              {q.totalAnswers} svar
                            </p>
                          )}
                        </div>
                      ))
                    : <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}>Ingen svardata tilgjengelig.</p>
              )}
            </div>
          )}

          {/* Neste steg */}
          <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #2a2d38', textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: '#7a7873', marginBottom: 14, letterSpacing: '0.04em' }}>
              Neste quiz kommer fredag
            </p>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
              {!authLoading && session && (
                <Link href="/historikk" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                  Se din quizhistorikk →
                </Link>
              )}
              <Link href="/toppliste" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                Se sesong-topplisten →
              </Link>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
