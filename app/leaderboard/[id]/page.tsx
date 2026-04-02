'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase, supabaseData, Quiz, Attempt } from '@/lib/supabase'
import { rankAttempts, getMedal } from '@/lib/ranking'
import { getSession, signOut } from '@/lib/auth'
import AuthModal from '@/components/AuthModal'
import Link from 'next/link'
import type { Session } from '@supabase/supabase-js'

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #1a1c23;
    --card:     #21242e;
    --border:   #2a2d38;
    --gold:     #c9a84c;
    --gold-bg:  rgba(201,168,76,0.10);
    --gold-bdr: rgba(201,168,76,0.22);
    --white:    #ffffff;
    --body:     #9a9590;
    --muted:    #6a6860;
    --green:    #4ade80;
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .lb-page {
    max-width: 640px;
    margin: 0 auto;
    padding: 0 20px 80px;
  }

  /* ── HEADER ── */
  .lb-header {
    padding: 48px 0 36px;
    text-align: center;
  }

  .lb-back {
    display: inline-block;
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    margin-bottom: 20px;
    transition: color 0.15s;
    letter-spacing: 0.04em;
  }

  .lb-back:hover { color: var(--gold); }

  .lb-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 8px;
  }

  .lb-title {
    font-family: 'Libre Baskerville', serif;
    font-size: clamp(28px, 6vw, 38px);
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.02em;
    margin-bottom: 6px;
  }

  .lb-title em { font-style: italic; color: var(--gold); }

  .lb-subtitle {
    font-family: 'Libre Baskerville', serif;
    font-size: 14px;
    color: var(--body);
    font-style: italic;
  }

  .lb-rule {
    width: 100%;
    height: 1px;
    background: var(--border);
    margin-top: 32px;
  }

  /* ── SECTION LABEL ── */
  .lb-section {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 32px 0 14px;
  }

  .lb-section-text {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }

  .lb-section-line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .lb-section-count {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    background: var(--card);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 20px;
  }

  /* ── ROW ── */
  .lb-row {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 16px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
    transition: border-color 0.15s;
    position: relative;
    overflow: hidden;
  }

  .lb-row.gold-row {
    border-color: var(--gold-bdr);
    background: linear-gradient(135deg, rgba(201,168,76,0.07) 0%, var(--card) 60%);
  }

  .lb-row.gold-row::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    background: var(--gold);
    border-radius: 3px 0 0 3px;
  }

  /* ── RANK ── */
  .lb-rank {
    width: 32px;
    text-align: center;
    flex-shrink: 0;
  }

  .lb-rank-medal {
    font-size: 22px;
    line-height: 1;
  }

  .lb-rank-num {
    font-family: 'Libre Baskerville', serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--muted);
  }

  .lb-rank-num.tied {
    font-size: 13px;
    color: var(--gold);
  }

  /* ── NAME BLOCK ── */
  .lb-name-block {
    flex: 1;
    min-width: 0;
  }

  .lb-name {
    font-family: 'Libre Baskerville', serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--white);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }

  .lb-name-meta {
    font-size: 12px;
    color: var(--muted);
  }

  /* ── SCORE BLOCK ── */
  .lb-score-block {
    text-align: right;
    flex-shrink: 0;
  }

  .lb-score {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    font-weight: 700;
    color: var(--gold);
    line-height: 1;
    margin-bottom: 3px;
  }

  .lb-score-pct {
    font-size: 11px;
    color: var(--muted);
  }

  .lb-score-pct .tied-label {
    color: var(--gold);
    margin-left: 4px;
  }

  /* ── AUTH GATE ── */
  .qk-auth-gate {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 20px 24px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .qk-auth-gate-text {
    flex: 1;
    min-width: 0;
  }

  .qk-auth-gate-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--white);
    margin-bottom: 3px;
  }

  .qk-auth-gate-sub {
    font-size: 12px;
    color: var(--muted);
  }

  .qk-auth-gate-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 16px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
    flex-shrink: 0;
  }

  .qk-auth-gate-btn:hover { background: #d9b85c; }

  .qk-profile-bar {
    background: rgba(201,168,76,0.06);
    border: 1px solid rgba(201,168,76,0.18);
    border-radius: var(--radius-card);
    padding: 14px 20px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .qk-profile-avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--border);
    border: 1.5px solid var(--gold-bdr);
    object-fit: cover;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--gold);
    overflow: hidden;
  }

  .qk-profile-name {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--white);
  }

  .qk-profile-sub {
    font-size: 11px;
    color: var(--muted);
    margin-top: 1px;
  }

  .qk-signout-btn {
    font-size: 12px;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 0;
    transition: color 0.15s;
    font-family: 'Instrument Sans', sans-serif;
  }

  .qk-signout-btn:hover { color: var(--body); }

  /* ── EMPTY / HIDDEN ── */
  .lb-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 56px 32px;
    text-align: center;
    margin-top: 32px;
  }

  .lb-empty-icon {
    font-size: 44px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .lb-empty-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    color: var(--white);
    margin-bottom: 8px;
  }

  .lb-empty-sub {
    font-size: 13px;
    color: var(--muted);
    line-height: 1.6;
    margin-bottom: 24px;
  }

  .lb-btn-primary {
    display: inline-block;
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 600;
    padding: 11px 24px;
    border-radius: var(--radius-btn);
    text-decoration: none;
    transition: background 0.15s;
  }

  .lb-btn-primary:hover { background: #d9b85c; }

  /* ── LOADING ── */
  .lb-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lb-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }

  /* ── SHIMMER SKELETON ── */
  .lb-skeleton {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 16px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }

  .lb-shimmer {
    background: linear-gradient(90deg, var(--border) 25%, #2f3340 50%, var(--border) 75%);
    background-size: 400% 100%;
    animation: shimmer 1.6s ease infinite;
    border-radius: 6px;
  }

  @keyframes shimmer {
    0%   { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  @media (max-width: 400px) {
    .lb-name { font-size: 14px; }
    .lb-score { font-size: 17px; }
    .lb-row { padding: 14px 16px; }
    .qk-auth-gate { flex-direction: column; align-items: flex-start; }
  }
`

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
    const s = await getSession()
    setSession(s)
    if (s?.user) {
      const { data: profile } = await supabaseData
        .from('profiles')
        .select('display_name, avatar_url, premium_status')
        .eq('id', s.user.id)
        .single()
      setProfile(profile)
      setDisplayName(profile?.display_name ?? s.user.email?.split('@')[0] ?? null)
      setAvatarUrl(profile?.avatar_url ?? null)
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
    const s = Math.floor(ms / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="lb-loading"><p>Laster leaderboard...</p></div>
    </>
  )

  if (!quiz) return (
    <>
      <style>{STYLES}</style>
      <div className="lb-loading"><p>Fant ikke quizen.</p></div>
    </>
  )

  if (!quiz.show_leaderboard) return (
    <>
      <style>{STYLES}</style>
      <div className="lb-loading" style={{ flexDirection: 'column', gap: 16 }}>
        <p>Leaderboard er ikke aktivert for denne quizen.</p>
        <Link href="/" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>← Tilbake til forsiden</Link>
      </div>
    </>
  )

  const isHidden = quiz.hide_leaderboard_until_closed && isOpen(quiz)
  const soloAttempts = rankAttempts(attempts.filter(a => !a.is_team))
  const teamAttempts = rankAttempts(attempts.filter(a => a.is_team))

  return (
    <>
      <style>{STYLES}</style>
      <AuthModal open={showModal} onClose={() => setShowModal(false)} />

      <div className="lb-page">

        <header className="lb-header">
          <Link href="/" className="lb-back">← Tilbake til forsiden</Link>
          <p className="lb-eyebrow">Quizkanonen</p>
          <h1 className="lb-title">Quiz<em>kanonen</em></h1>
          <p className="lb-subtitle">{quiz.title}</p>
          <div className="lb-rule" />
        </header>

        {/* Auth gate / profile bar */}
        {!authLoading && session ? (
          <div className="qk-profile-bar">
            <div className="qk-profile-avatar">
              {avatarUrl
                ? <img src={avatarUrl} alt="" width={34} height={34} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (displayName?.[0]?.toUpperCase() ?? '?')
              }
            </div>
            <div style={{ flex: 1 }}>
              <p className="qk-profile-name">{displayName}</p>
              <p className="qk-profile-sub">Din nøyaktige plassering vises i listen nedenfor</p>
            </div>
            <button onClick={handleSignOut} className="qk-signout-btn">Logg ut</button>
          </div>
        ) : !authLoading ? (
          <div className="qk-auth-gate">
            <div className="qk-auth-gate-text">
              <p className="qk-auth-gate-title">Finn din plassering</p>
              <p className="qk-auth-gate-sub">Logg inn med Google for å se nøyaktig hvor du havnet</p>
            </div>
            <button onClick={() => setShowModal(true)} className="qk-auth-gate-btn">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
                <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
                <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
                <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
              </svg>
              Logg inn med Google
            </button>
          </div>
        ) : null}

        {!authLoading && session && !isPremium && (
          <div style={{ background: '#21242e', border: '1px solid #c9a84c', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
            <div style={{ color: '#d0d3e0', fontSize: '0.95rem' }}>
              🔒 Se nøyaktig plassering og historikk med <strong style={{ color: '#c9a84c' }}>Premium</strong>
            </div>
            <a href="/premium" style={{ background: '#c9a84c', color: '#1a1c23', padding: '8px 18px', borderRadius: '8px', fontWeight: 700, fontSize: '0.9rem', textDecoration: 'none', whiteSpace: 'nowrap' as const }}>
              Bli Premium
            </a>
          </div>
        )}

        {isHidden ? (
          <div className="lb-empty">
            <div className="lb-empty-icon">🔒</div>
            <p className="lb-empty-title">Leaderboardet er skjult</p>
            <p className="lb-empty-sub">
              Vises når quizen stenger:<br />
              {new Date(quiz.closes_at).toLocaleString('no-NO')}
            </p>
            <Link href={`/quiz/${quizId}`} className="lb-btn-primary">
              Spill quizen →
            </Link>
          </div>
        ) : attempts.length === 0 ? (
          <div className="lb-empty">
            <div className="lb-empty-icon">🏔️</div>
            <p className="lb-empty-title">Ingen resultater ennå</p>
            <p className="lb-empty-sub">Vær den første til å fullføre denne quizen.</p>
            <Link href={`/quiz/${quizId}`} className="lb-btn-primary">
              Spill quizen →
            </Link>
          </div>
        ) : (
          <>
            {soloAttempts.length > 0 && (
              <>
                <div className="lb-section">
                  <span className="lb-section-text">Enkeltpersoner</span>
                  <div className="lb-section-line" />
                  <span className="lb-section-count">{soloAttempts.length}</span>
                </div>

                {soloAttempts.map(attempt => (
                  <div key={attempt.id} className={`lb-row ${attempt.rank === 1 ? 'gold-row' : ''}`}>
                    <div className="lb-rank">
                      {attempt.isTied
                        ? <span className="lb-rank-num tied">{attempt.rank}=</span>
                        : <span className="lb-rank-medal">{getMedal(attempt.rank)}</span>
                      }
                    </div>
                    <div className="lb-name-block">
                      <p className="lb-name">{attempt.player_name}</p>
                      <p className="lb-name-meta">⏱ {formatTime(attempt.total_time_ms)}</p>
                    </div>
                    <div className="lb-score-block">
                      <p className="lb-score">{attempt.correct_answers}/{attempt.total_questions}</p>
                      <p className="lb-score-pct">
                        {Math.round((attempt.correct_answers / attempt.total_questions) * 100)}%
                        {attempt.isTied && <span className="tied-label">delt</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}

            {teamAttempts.length > 0 && (
              <>
                <div className="lb-section">
                  <span className="lb-section-text">Lag</span>
                  <div className="lb-section-line" />
                  <span className="lb-section-count">{teamAttempts.length}</span>
                </div>

                {teamAttempts.map(attempt => (
                  <div key={attempt.id} className={`lb-row ${attempt.rank === 1 ? 'gold-row' : ''}`}>
                    <div className="lb-rank">
                      {attempt.isTied
                        ? <span className="lb-rank-num tied">{attempt.rank}=</span>
                        : <span className="lb-rank-medal">{getMedal(attempt.rank)}</span>
                      }
                    </div>
                    <div className="lb-name-block">
                      <p className="lb-name">
                        {attempt.player_name}
                        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 6 }}>
                          {attempt.team_size} stk
                        </span>
                      </p>
                      <p className="lb-name-meta">⏱ {formatTime(attempt.total_time_ms)}</p>
                    </div>
                    <div className="lb-score-block">
                      <p className="lb-score">{attempt.correct_answers}/{attempt.total_questions}</p>
                      <p className="lb-score-pct">
                        {Math.round((attempt.correct_answers / attempt.total_questions) * 100)}%
                        {attempt.isTied && <span className="tied-label">delt</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
