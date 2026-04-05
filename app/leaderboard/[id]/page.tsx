'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase, supabaseData, Quiz, Attempt } from '@/lib/supabase'
import { rankAttempts, getMedal, RankedAttempt } from '@/lib/ranking'
import { getSession, signOut } from '@/lib/auth'
import AuthModal from '@/components/AuthModal'
import Link from 'next/link'
import type { Session } from '@supabase/supabase-js'

const podiumStyles = `
  @keyframes podiumSlideIn {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .podium-row-1 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 400ms; }
  .podium-row-2 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 200ms; }
  .podium-row-3 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 0ms; }
  @keyframes podiumFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .podium-rest  { animation: podiumFadeIn 200ms ease-out both; animation-delay: 700ms; }
`

const s = {
  wrap:         { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' },
  page:         { maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' },
  centered:     { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  centeredText: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#6a6860', fontStyle: 'italic' as const },

  header:   { padding: '48px 0 36px', textAlign: 'center' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#6a6860', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' },
  eyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  title:    { fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(28px, 6vw, 38px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 },
  titleEm:  { fontStyle: 'italic', color: '#c9a84c' },
  subtitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 14, color: '#7a7873', fontStyle: 'italic' as const },
  rule:     { width: '100%', height: 1, background: '#2a2d38', marginTop: 32 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '32px 0 14px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#6a6860', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  row:          { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  rowGold:      { background: 'linear-gradient(135deg, rgba(201,168,76,0.07) 0%, #21242e 60%)', border: '1px solid rgba(201,168,76,0.22)', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  rowHighlight: { background: '#252836', border: '1px solid #c9a84c', borderRadius: 20, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  goldStripe:   { position: 'absolute' as const, left: 0, top: 0, bottom: 0, width: 3, background: '#c9a84c', borderRadius: '3px 0 0 3px' },

  rankCell: { width: 32, textAlign: 'center' as const, flexShrink: 0 },
  medal:    { fontSize: 22, lineHeight: '1', display: 'block' },
  rankNum:  { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#6a6860', display: 'block' },
  rankTied: { fontFamily: "'Libre Baskerville', serif", fontSize: 13, fontWeight: 700, color: '#c9a84c', display: 'block' },

  nameBlock: { flex: 1, minWidth: 0 },
  name:      { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, marginBottom: 2 },
  nameSub:   { fontSize: 12, color: '#6a6860' },

  scoreBlock: { textAlign: 'right' as const, flexShrink: 0 },
  score:      { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', lineHeight: '1', marginBottom: 3 },
  scoreSub:   { fontSize: 11, color: '#6a6860' },
  tiedLabel:  { color: '#c9a84c', marginLeft: 4 },

  profileBar: { background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 20, padding: '14px 20px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 },
  avatar:     { width: 34, height: 34, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#c9a84c', overflow: 'hidden' as const },

  card:       { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px 24px', marginBottom: 12 },
  cardRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' as const },
  cardTitle:  { fontSize: 14, fontWeight: 700, color: '#ffffff', marginBottom: 3 },
  cardSub:    { fontSize: 12, color: '#6a6860' },

  btnGold:    { display: 'inline-flex', alignItems: 'center', gap: 8, background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0, textDecoration: 'none' },
  btnOutline: { background: 'none', color: '#6a6860', fontFamily: "'Instrument Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: '4px 0', border: 'none', cursor: 'pointer' },
  btnMore:    { width: '100%', padding: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, color: '#7a7873', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", marginTop: 4, marginBottom: 16 },

  separator: { textAlign: 'center' as const, fontSize: 11, color: '#6a6860', letterSpacing: '0.1em', textTransform: 'uppercase' as const, margin: '12px 0 8px', fontWeight: 600 },

  tabRow:     { display: 'flex', borderBottom: '1px solid #2a2d38', marginBottom: 16 },
  tabActive:  { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid #c9a84c', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  tabInactive:{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#6a6860', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  tabEmpty:   { padding: '24px 0', textAlign: 'center' as const, fontSize: 13, color: '#6a6860', fontStyle: 'italic' as const },

  empty:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 32 },
  emptyIcon: { fontSize: 44, marginBottom: 16, opacity: 0.5 },
  emptyTitle:{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, color: '#ffffff', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#6a6860', lineHeight: 1.6, marginBottom: 24 },
  btnLink:   { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 10, textDecoration: 'none' },
}

type BadgeKind = 'krone' | 'pil' | 'flamme' | 'lyn' | 'medalje'

function BadgeCircle({ badge, size = 18 }: { badge: BadgeKind; size?: number }) {
  const bg = badge === 'krone' ? '#c9a84c' : badge === 'pil' ? '#3B6D11' : badge === 'flamme' ? '#E24B4A' : badge === 'lyn' ? '#7ABFFF' : '#639922'
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
  const [profile, setProfile] = useState<{ display_name: string | null, avatar_url: string | null, premium_status: boolean | null } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [visibleSoloCount, setVisibleSoloCount] = useState(10)
  const [visibleTeamCount, setVisibleTeamCount] = useState(10)
  const [scrollPending, setScrollPending] = useState(false)
  const [savedResult, setSavedResult] = useState<{ correct_answers: number; total_time_ms: number } | null>(null)
  const [friendNames, setFriendNames] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'alle' | 'venner' | 'lag'>('alle')
  const [visibleVennerCount, setVisibleVennerCount] = useState(10)
  const [memberInfoMap, setMemberInfoMap] = useState<Map<string, { member_number: number | null, show_member_number: boolean, avatar_url: string | null }>>(new Map())
  const [prevRankMap, setPrevRankMap] = useState<Map<string, number>>(new Map())
  const [mostImprovedName, setMostImprovedName] = useState<string | null>(null)
  const [podiumActive, setPodiumActive] = useState(false)

  useEffect(() => {
    async function fetchData() {
      try {
        const [{ data: quizData, error: e1 }, { data: attemptData, error: e2 }] = await Promise.all([
          supabaseData.from('quizzes').select('*').eq('id', quizId).single(),
          supabaseData.from('attempts').select('*').eq('quiz_id', quizId).limit(200),
        ])
        const err = e1 ?? e2
        if (err) throw err
        setQuiz(quizData)
        const attemptsResult = attemptData || []
        setAttempts(attemptsResult)

        const userIds = [...new Set(attemptsResult.map((a: Attempt) => a.user_id).filter((id): id is string => !!id))]
        if (userIds.length > 0) {
          const { data: memberProfiles } = await supabaseData
            .from('profiles')
            .select('id, member_number, show_member_number, avatar_url')
            .in('id', userIds)
          if (memberProfiles) {
            const map = new Map<string, { member_number: number | null, show_member_number: boolean, avatar_url: string | null }>()
            for (const p of memberProfiles as { id: string, member_number: number | null, show_member_number: boolean | null, avatar_url: string | null }[]) {
              map.set(p.id, { member_number: p.member_number ?? null, show_member_number: p.show_member_number ?? false, avatar_url: p.avatar_url ?? null })
            }
            setMemberInfoMap(map)
          }
        }

        // Fetch previous quiz for "pil opp" badge
        if (quizData) {
          try {
            const { data: prevQuiz } = await supabaseData
              .from('quizzes')
              .select('id')
              .lt('closes_at', quizData.closes_at)
              .order('closes_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (prevQuiz) {
              const { data: prevAttemptData } = await supabaseData
                .from('attempts')
                .select('id, quiz_id, player_name, is_team, team_size, correct_answers, total_questions, total_time_ms, correct_streak, user_id, completed_at')
                .eq('quiz_id', prevQuiz.id)
                .eq('is_team', false)
                .limit(200)
              if (prevAttemptData && prevAttemptData.length > 0) {
                const prevRanked = rankAttempts(prevAttemptData as Attempt[])
                const map = new Map<string, number>()
                for (const a of prevRanked) {
                  if (!map.has(a.player_name)) map.set(a.player_name, a.rank)
                }
                setPrevRankMap(map)
              }
            }
          } catch { /* Previous quiz data is optional */ }
        }
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
    const sess = await getSession()
    setSession(sess)
    if (sess?.user) {
      const { data: prof } = await supabaseData
        .from('profiles')
        .select('display_name, avatar_url, premium_status')
        .eq('id', sess.user.id)
        .single()
      setProfile(prof)
      setDisplayName(prof?.display_name ?? sess.user.email?.split('@')[0] ?? null)
      setAvatarUrl(prof?.avatar_url ?? null)

      // Hent ligamedlemmer for "Blant venner"-fane
      try {
        const leaguesRes = await fetch('/api/leagues', {
          headers: { Authorization: `Bearer ${sess.access_token}` },
        })
        if (leaguesRes.ok) {
          const leaguesJson = await leaguesRes.json()
          const leagues: { id: string }[] = leaguesJson.leagues ?? []
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

  useEffect(() => {
    if (prevRankMap.size === 0 || attempts.length === 0) return
    const currentRanked = rankAttempts(attempts.filter(a => !a.is_team))
    let best: { name: string; improvement: number } | null = null
    for (const a of currentRanked) {
      const prevRank = prevRankMap.get(a.player_name)
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

  const isPremium = profile?.premium_status === true

  const isOpen = (q: Quiz) => {
    const now = new Date()
    return new Date(q.opens_at) <= now && new Date(q.closes_at) >= now
  }

  const formatTime = (ms: number) => {
    const sec = Math.floor(ms / 1000)
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
  }

  if (loading) return (
    <div style={s.centered}><p style={s.centeredText}>Laster leaderboard...</p></div>
  )

  if (!quiz) return (
    <div style={s.centered}><p style={s.centeredText}>Fant ikke quizen.</p></div>
  )

  if (!quiz.show_leaderboard) return (
    <div style={{ ...s.centered, flexDirection: 'column', gap: 16 }}>
      <p style={s.centeredText}>Leaderboard er ikke aktivert for denne quizen.</p>
      <Link href="/" style={{ fontSize: 13, color: '#6a6860', textDecoration: 'none' }}>← Tilbake til forsiden</Link>
    </div>
  )

  const isHidden = quiz.hide_leaderboard_until_closed && isOpen(quiz)
  const soloAttempts = rankAttempts(attempts.filter(a => !a.is_team))
  const teamAttempts = rankAttempts(attempts.filter(a => a.is_team))
  const friendAttempts = rankAttempts(attempts.filter(a => !a.is_team && friendNames.has(a.player_name)))
  const showVennerTab = !!session && friendAttempts.length > 0
  const totalCount = soloAttempts.length + teamAttempts.length

  const userSoloAttempt = displayName ? soloAttempts.find(a => a.player_name === displayName) ?? null : null
  const userTeamAttempt = displayName ? teamAttempts.find(a => a.player_name === displayName) ?? null : null
  const userAttempt = userSoloAttempt ?? userTeamAttempt

  function handleGoToMyPlacement() {
    if (!userAttempt) return
    if (userSoloAttempt && userAttempt.rank > visibleSoloCount) setVisibleSoloCount(userAttempt.rank + 5)
    if (userTeamAttempt && !userSoloAttempt && userAttempt.rank > visibleTeamCount) setVisibleTeamCount(userAttempt.rank + 5)
    setScrollPending(true)
  }

  const fastestSoloName = soloAttempts.length > 0
    ? soloAttempts.reduce((f, a) => a.total_time_ms < f.total_time_ms ? a : f).player_name
    : null

  const renderRow = (attempt: RankedAttempt, isUser: boolean, extraClass?: string) => {
    const isFirst = attempt.rank === 1 && !attempt.isTied
    const rowStyle = isUser ? s.rowHighlight : isFirst ? s.rowGold : s.row

    const avatarUrl = attempt.user_id ? (memberInfoMap.get(attempt.user_id)?.avatar_url ?? null) : null
    const initial = attempt.player_name[0]?.toUpperCase() ?? '?'

    let badge: BadgeKind | null = null
    if (attempt.rank === 1) badge = 'krone'
    else if (attempt.player_name === mostImprovedName) badge = 'pil'
    else if ((attempt.correct_streak ?? 0) >= 3) badge = 'flamme'
    else if (attempt.player_name === fastestSoloName) badge = 'lyn'
    else if (attempt.rank <= 3) badge = 'medalje'

    return (
      <div key={attempt.id} id={isUser ? 'user-row' : undefined} style={rowStyle} className={extraClass}>
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
            {attempt.player_name}
            {!attempt.user_id && <span style={{ fontSize: 12, color: '#7a7873', fontWeight: 400, marginLeft: 6 }}>(guest)</span>}
          </p>
          <p style={s.nameSub}>
            {attempt.is_team && <span style={{ marginRight: 6 }}>Lag · {attempt.team_size} stk ·</span>}
            ⏱ {formatTime(attempt.total_time_ms)}
          </p>
        </div>
        <div style={s.scoreBlock}>
          <p style={s.score}>{attempt.correct_answers}/{attempt.total_questions}</p>
          <p style={s.scoreSub}>
            {formatTime(attempt.total_time_ms)}
            {attempt.isTied && <span style={s.tiedLabel}>delt</span>}
          </p>
        </div>
      </div>
    )
  }

  const renderSection = (ranked: RankedAttempt[], label: string, visibleCount: number, onShowMore: () => void, isPodium = false) => {
    if (ranked.length === 0) return null
    const visible = ranked.slice(0, visibleCount)
    const userInSection = displayName ? ranked.find(a => a.player_name === displayName) ?? null : null
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
        {visible.map(attempt => renderRow(attempt, attempt.player_name === displayName, podiumClass(attempt.rank)))}
        {userOutsideVisible && (
          <>
            <p style={s.separator}>— Din plassering —</p>
            {renderRow(userInSection, true)}
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

  const isClosed = quiz ? new Date(quiz.closes_at) < new Date() : false

  return (
    <>
      <style>{podiumStyles}</style>
      <AuthModal open={showModal} onClose={() => setShowModal(false)} />
      <div style={s.wrap}>
        <div style={s.page}>

          <header style={s.header}>
            <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
            <p style={s.eyebrow}>Quizkanonen</p>
            <h1 style={s.title}>Quiz<em style={s.titleEm}>kanonen</em></h1>
            <p style={s.subtitle}>{quiz.title}</p>
            <div style={s.rule} />
          </header>

          {/* Profile bar */}
          {!authLoading && session && (
            <div style={s.profileBar}>
              <div style={s.avatar}>
                {avatarUrl
                  ? <img src={avatarUrl} alt="" width={34} height={34} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (displayName?.[0]?.toUpperCase() ?? '?')
                }
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>{displayName}</p>
                <p style={{ fontSize: 11, color: '#6a6860', marginTop: 1 }}>Innlogget</p>
              </div>
              <button onClick={handleSignOut} style={s.btnOutline}>Logg ut</button>
            </div>
          )}

          {/* Placement card — kun for ikke-innloggede og kun hvis det finnes resultater */}
          {!authLoading && !session && totalCount > 0 && (() => {
            let rangeX = 1
            let rangeY = Math.min(10, totalCount)
            if (savedResult) {
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
                <div style={s.cardRow}>
                  <div>
                    <p style={s.cardTitle}>Du er et sted mellom plass {rangeX} og {rangeY}</p>
                    <p style={s.cardSub}>Logg inn for å se nøyaktig plassering</p>
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

          {isHidden ? (
            <div style={s.empty}>
              <div style={{ ...s.emptyIcon, fontSize: undefined }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <p style={s.emptyTitle}>Topplisten publiseres når quizen stenger</p>
              <p style={s.emptySub}>
                Vises når quizen stenger:<br />
                {new Date(quiz.closes_at).toLocaleString('no-NO')}
              </p>
              <Link href="/" style={s.btnLink}>Tilbake til forsiden →</Link>
            </div>
          ) : attempts.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyIcon}>🏔️</div>
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

              {activeTab === 'alle' && renderSection(soloAttempts, 'Enkeltpersoner', visibleSoloCount, () => setVisibleSoloCount(c => c + 10), isClosed)}

              {activeTab === 'venner' && (
                friendAttempts.length > 0
                  ? renderSection(friendAttempts, 'Blant venner', visibleVennerCount, () => setVisibleVennerCount(c => c + 10))
                  : <p style={s.tabEmpty}>Ingen ligavenner har spilt denne quizen ennå</p>
              )}

              {activeTab === 'lag' && renderSection(teamAttempts, 'Lag', visibleTeamCount, () => setVisibleTeamCount(c => c + 10))}

              {/* Badge legend */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 20, paddingTop: 16, borderTop: '1px solid #2a2d38' }}>
                {([
                  { badge: 'krone', label: 'Leder' },
                  { badge: 'pil', label: 'Størst fremgang' },
                  { badge: 'flamme', label: 'Streak 3+' },
                  { badge: 'lyn', label: 'Raskest' },
                  { badge: 'medalje', label: 'Topp 3' },
                ] as { badge: BadgeKind; label: string }[]).map(({ badge, label }) => (
                  <span key={badge} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#7a7873' }}>
                    <BadgeCircle badge={badge} size={14} />
                    {label}
                  </span>
                ))}
              </div>
            </>
          )}

        </div>
      </div>
    </>
  )
}
