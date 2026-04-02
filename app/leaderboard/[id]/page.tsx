'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase, supabaseData, Quiz, Attempt } from '@/lib/supabase'
import { rankAttempts, getMedal, RankedAttempt } from '@/lib/ranking'
import { getSession, signOut } from '@/lib/auth'
import AuthModal from '@/components/AuthModal'
import Link from 'next/link'
import type { Session } from '@supabase/supabase-js'

const s = {
  wrap:         { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#9a9590' },
  page:         { maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' },
  centered:     { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  centeredText: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#6a6860', fontStyle: 'italic' as const },

  header:   { padding: '48px 0 36px', textAlign: 'center' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#6a6860', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' },
  eyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  title:    { fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(28px, 6vw, 38px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 },
  titleEm:  { fontStyle: 'italic', color: '#c9a84c' },
  subtitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 14, color: '#9a9590', fontStyle: 'italic' as const },
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
  btnMore:    { width: '100%', padding: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, color: '#9a9590', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", marginTop: 4, marginBottom: 16 },

  separator: { textAlign: 'center' as const, fontSize: 11, color: '#6a6860', letterSpacing: '0.1em', textTransform: 'uppercase' as const, margin: '12px 0 8px', fontWeight: 600 },

  empty:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 32 },
  emptyIcon: { fontSize: 44, marginBottom: 16, opacity: 0.5 },
  emptyTitle:{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, color: '#ffffff', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#6a6860', lineHeight: 1.6, marginBottom: 24 },
  btnLink:   { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 10, textDecoration: 'none' },
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

  useEffect(() => {
    async function fetchData() {
      const [{ data: quizData }, { data: attemptData }] = await Promise.all([
        supabaseData.from('quizzes').select('*').eq('id', quizId).single(),
        supabaseData.from('attempts').select('*').eq('quiz_id', quizId).limit(200),
      ])
      setQuiz(quizData)
      setAttempts(attemptData || [])
      setLoading(false)
    }
    fetchData()
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
    if (!scrollPending) return
    const el = document.getElementById('user-row')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setScrollPending(false)
    }
  }, [scrollPending])

  const handleSignOut = async () => {
    await signOut()
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

  const renderRow = (attempt: RankedAttempt, isUser: boolean) => {
    const isFirst = attempt.rank === 1 && !attempt.isTied
    const rowStyle = isUser ? s.rowHighlight : isFirst ? s.rowGold : s.row
    return (
      <div key={attempt.id} id={isUser ? 'user-row' : undefined} style={rowStyle}>
        {isFirst && <div style={s.goldStripe} />}
        <div style={s.rankCell}>
          {attempt.isTied
            ? <span style={s.rankTied}>{attempt.rank}=</span>
            : attempt.rank <= 3
              ? <span style={s.medal}>{getMedal(attempt.rank)}</span>
              : <span style={s.rankNum}>{attempt.rank}</span>
          }
        </div>
        <div style={s.nameBlock}>
          <p style={s.name}>{attempt.player_name}</p>
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

  const renderSection = (ranked: RankedAttempt[], label: string, visibleCount: number, onShowMore: () => void) => {
    if (ranked.length === 0) return null
    const visible = ranked.slice(0, visibleCount)
    const userInSection = displayName ? ranked.find(a => a.player_name === displayName) ?? null : null
    const userOutsideVisible = userInSection && userInSection.rank > visibleCount
    const remaining = ranked.length - visibleCount
    return (
      <div key={label}>
        <div style={s.sectionHeader}>
          <span style={s.sectionText}>{label}</span>
          <div style={s.sectionLine} />
          <span style={s.sectionCount}>{ranked.length}</span>
        </div>
        {visible.map(attempt => renderRow(attempt, attempt.player_name === displayName))}
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

  return (
    <>
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

          {/* Placement card */}
          {!authLoading && (
            <div style={s.card}>
              {!session ? (
                <div style={s.cardRow}>
                  <div>
                    <p style={s.cardTitle}>Finn din plassering</p>
                    <p style={s.cardSub}>Logg inn for å se nøyaktig hvor du havnet</p>
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
              ) : null}
            </div>
          )}

          {isHidden ? (
            <div style={s.empty}>
              <div style={s.emptyIcon}>🔒</div>
              <p style={s.emptyTitle}>Leaderboardet er skjult</p>
              <p style={s.emptySub}>
                Vises når quizen stenger:<br />
                {new Date(quiz.closes_at).toLocaleString('no-NO')}
              </p>
              <Link href={`/quiz/${quizId}`} style={s.btnLink}>Spill quizen →</Link>
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
              {renderSection(soloAttempts, 'Enkeltpersoner', visibleSoloCount, () => setVisibleSoloCount(c => c + 10))}
              {renderSection(teamAttempts, 'Lag', visibleTeamCount, () => setVisibleTeamCount(c => c + 10))}
            </>
          )}

        </div>
      </div>
    </>
  )
}
