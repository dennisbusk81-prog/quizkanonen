'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn, logoutAdmin } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:    #1a1c23;
    --card:  #21242e;
    --border:#2a2d38;
    --gold:  #c9a84c;
    --white: #ffffff;
    --body:  #e8e4dd;
    --hint:  #7a7873;
    --muted: #7a7873;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .adm-page { max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }

  /* Header */
  .adm-header {
    padding: 24px 0 28px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .adm-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 6px;
  }
  .adm-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }
  .adm-title em { font-style: italic; color: var(--gold); }
  .adm-header-actions { display: flex; gap: 8px; align-items: center; padding-top: 6px; }

  .adm-btn-ghost {
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 8px;
    padding: 6px 14px;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.15s, border-color 0.15s;
    display: inline-block;
  }
  .adm-btn-ghost:hover { color: var(--white); border-color: rgba(255,255,255,0.15); }

  .adm-btn-danger {
    font-size: 12px;
    font-weight: 500;
    color: #f87171;
    background: transparent;
    border: 0.5px solid rgba(248,113,113,0.35);
    border-radius: 8px;
    padding: 6px 14px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .adm-btn-danger:hover { background: rgba(248,113,113,0.08); }

  .adm-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 28px; }

  /* Quick actions */
  .adm-actions { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }

  .adm-btn-primary {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    background: #c9a84c;
    color: #1a1c23;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    transition: opacity 0.15s;
  }
  .adm-btn-primary:hover { opacity: 0.88; }
  .adm-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .adm-btn-primary-sm {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    background: transparent;
    color: var(--body);
    border: 0.5px solid var(--border);
    border-radius: 8px;
    padding: 7px 14px;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .adm-btn-primary-sm:hover { border-color: rgba(255,255,255,0.2); color: var(--white); }
  .adm-btn-primary-sm:disabled { opacity: 0.4; cursor: not-allowed; }

  .adm-btn-outline {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    background: transparent;
    color: var(--body);
    border: 0.5px solid var(--border);
    border-radius: 8px;
    padding: 8px 16px;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    transition: border-color 0.15s, color 0.15s;
  }
  .adm-btn-outline:hover { border-color: rgba(255,255,255,0.2); color: var(--white); }

  /* Stats grid */
  .adm-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }

  .adm-stat {
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 12px;
    padding: 14px 12px;
    text-decoration: none;
    display: block;
    transition: border-color 0.15s;
  }
  .adm-stat:hover { border-color: rgba(201,168,76,0.25); }

  .adm-stat-value {
    font-family: 'Libre Baskerville', serif;
    font-size: 24px;
    font-weight: 700;
    color: var(--white);
    margin-bottom: 4px;
  }
  .adm-stat-label {
    font-size: 10px;
    font-weight: 400;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    line-height: 1.4;
    margin-bottom: 8px;
  }
  .adm-stat-link { font-size: 11px; color: var(--gold); }

  /* Next quiz row */
  .adm-nq {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    margin-bottom: 16px;
  }
  .adm-nq-label {
    font-size: 11px;
    color: var(--hint);
    white-space: nowrap;
    letter-spacing: 0.06em;
  }
  .adm-nq-input {
    flex: 1;
    background: #16191f;
    border: 0.5px solid var(--border);
    border-radius: 8px;
    padding: 7px 10px;
    color: var(--white);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    colorScheme: dark;
    min-width: 0;
    transition: border-color 0.15s;
  }
  .adm-nq-input:focus { border-color: rgba(201,168,76,0.4); }
  .adm-nq-feedback {
    font-size: 11px;
    white-space: nowrap;
    padding: 3px 8px;
    border-radius: 6px;
  }
  .adm-nq-feedback--success { color: #4ade80; background: rgba(74,222,128,0.08); }
  .adm-nq-feedback--error { color: #f87171; background: rgba(248,113,113,0.08); }

  /* Recent quizzes */
  .adm-section {
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 16px;
  }
  .adm-section-label {
    font-size: 10px;
    font-weight: 400;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 12px;
  }
  .adm-quiz-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 0.5px solid var(--border);
  }
  .adm-quiz-row:last-child { border-bottom: none; padding-bottom: 0; }
  .adm-quiz-row:first-of-type { padding-top: 0; }
  .adm-quiz-name { font-size: 13px; color: var(--body); }
  .adm-quiz-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

  .adm-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 999px;
  }
  .adm-badge--open { background: rgba(74,222,128,0.1); color: #4ade80; border: 0.5px solid rgba(74,222,128,0.2); }
  .adm-badge--closed { background: rgba(201,168,76,0.1); color: var(--gold); border: 0.5px solid rgba(201,168,76,0.2); }
  .adm-badge--hidden { background: rgba(122,120,115,0.1); color: var(--hint); border: 0.5px solid rgba(122,120,115,0.2); }

  .adm-quiz-link {
    font-size: 12px;
    color: var(--hint);
    text-decoration: none;
    transition: color 0.15s;
  }
  .adm-quiz-link:hover { color: var(--gold); }

  /* Nav grid */
  .adm-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

  .adm-nav-card {
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    text-decoration: none;
    transition: border-color 0.15s;
  }
  .adm-nav-card:hover { border-color: rgba(201,168,76,0.25); }
  .adm-nav-card--disabled { cursor: default; opacity: 0.5; }
  .adm-nav-card--disabled:hover { border-color: var(--border); }

  .adm-nav-title { font-size: 14px; font-weight: 600; color: var(--white); margin-bottom: 2px; }
  .adm-nav-title--muted { color: var(--hint); }
  .adm-nav-desc { font-size: 11px; color: var(--hint); }
  .adm-nav-arrow { font-size: 14px; color: var(--hint); flex-shrink: 0; }

  /* Loading */
  .adm-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .adm-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }

  @media (max-width: 520px) {
    .adm-stats { grid-template-columns: 1fr 1fr; }
    .adm-nav { grid-template-columns: 1fr; }
    .adm-nq { flex-wrap: wrap; }
    .adm-nq-input { width: 100%; }
  }
`

type Stats = { quizzes: number; players: number; active30d: number; premium: number }
type QuizRow = { id: string; title: string; is_active: boolean; created_at: string; updated_at: string }
type ResetModal = null | 'all' | 'test'

export default function AdminHome() {
  const router = useRouter()
  const [stats, setStats] = useState<Stats>({ quizzes: 0, players: 0, active30d: 0, premium: 0 })
  const [recentQuizzes, setRecentQuizzes] = useState<QuizRow[]>([])
  const [nextQuizValue, setNextQuizValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [resetModal, setResetModal] = useState<ResetModal>(null)
  const [resetInput, setResetInput] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    fetchAll()
    fetchNextQuiz()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchAll() {
    try {
      const [statsRes, quizzesRes] = await Promise.all([
        adminFetch('/api/admin/stats'),
        adminFetch('/api/admin/quizzes'),
      ])
      if (statsRes.ok) {
        const data = await statsRes.json()
        setStats({ quizzes: data.quizzes ?? 0, players: data.players ?? 0, active30d: data.active30d ?? 0, premium: data.premium ?? 0 })
      }
      if (quizzesRes.ok) {
        const all: QuizRow[] = await quizzesRes.json()
        const sorted = [...all].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        setRecentQuizzes(sorted.slice(0, 3))
      }
    } catch (e) {
      console.error('fetchAll feilet:', e)
    } finally {
      setLoading(false)
    }
  }

  async function fetchNextQuiz() {
    const { data, error } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'next_quiz_at')
      .single()
    if (error && error.code !== 'PGRST116') console.error('fetchNextQuiz feilet:', error)
    if (data?.value) {
      const d = new Date(data.value)
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      setNextQuizValue(local)
    }
  }

  async function saveNextQuiz() {
    if (!nextQuizValue) return
    setSaving(true)
    const isoValue = new Date(nextQuizValue).toISOString()
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key: 'next_quiz_at', value: isoValue, updated_at: new Date().toISOString() })
    setFeedback(error
      ? { type: 'error', msg: 'Kunne ikke lagre' }
      : { type: 'success', msg: 'Lagret!' }
    )
    setSaving(false)
    setTimeout(() => setFeedback(null), 3000)
  }

  async function handleReset() {
    if (!resetModal || resetInput !== 'NULLSTILL' || resetting) return
    setResetting(true)
    try {
      const res = await adminFetch('/api/admin/season-scores/reset', {
        method: 'POST',
        body: JSON.stringify({ scope: resetModal }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'Noe gikk galt.'); return }
      setResetModal(null)
      setResetInput('')
      setResetDone(resetModal === 'all' ? 'All sesong-data nullstilt.' : 'Testdata nullstilt.')
      setTimeout(() => setResetDone(null), 4000)
    } finally {
      setResetting(false)
    }
  }

  const handleLogout = () => { logoutAdmin(); router.push('/admin/login') }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="adm-loading"><p>Laster...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="adm-page">

        <header className="adm-header">
          <div>
            <p className="adm-eyebrow">Quizkanonen</p>
            <h1 className="adm-title">Admin<em>panel</em></h1>
          </div>
          <div className="adm-header-actions">
            <Link href="/" target="_blank" className="adm-btn-ghost">Se siden ↗</Link>
            <button onClick={handleLogout} className="adm-btn-danger">Logg ut</button>
          </div>
        </header>

        <div className="adm-rule" />

        {/* Quick actions */}
        <div className="adm-actions">
          <Link href="/admin/quizzes/new" className="adm-btn-primary">+ Lag ny quiz</Link>
          <Link href="/admin/quizzes" className="adm-btn-outline">Administrer quizer →</Link>
          <Link href="/admin/codes" className="adm-btn-outline">Verdikoder →</Link>
        </div>

        {/* Stats */}
        <div className="adm-stats">
          <Link href="/admin/quizzes" className="adm-stat">
            <div className="adm-stat-value">{stats.players}</div>
            <div className="adm-stat-label">Registrerte spillere</div>
            <div className="adm-stat-link">Se mer →</div>
          </Link>
          <Link href="/admin/quizzes" className="adm-stat">
            <div className="adm-stat-value">{stats.active30d}</div>
            <div className="adm-stat-label">Aktive 30 dager</div>
            <div className="adm-stat-link">Se mer →</div>
          </Link>
          <Link href="/admin/quizzes" className="adm-stat">
            <div className="adm-stat-value">{stats.quizzes}</div>
            <div className="adm-stat-label">Quizer totalt</div>
            <div className="adm-stat-link">Se mer →</div>
          </Link>
          <Link href="/admin/codes" className="adm-stat">
            <div className="adm-stat-value">{stats.premium}</div>
            <div className="adm-stat-label">Premium-brukere</div>
            <div className="adm-stat-link">Se mer →</div>
          </Link>
        </div>

        {/* Next quiz compact row */}
        <div className="adm-nq">
          <span className="adm-nq-label">Neste quiz</span>
          <input
            type="datetime-local"
            value={nextQuizValue}
            onChange={e => setNextQuizValue(e.target.value)}
            className="adm-nq-input"
            style={{ colorScheme: 'dark' }}
          />
          {feedback && (
            <span className={`adm-nq-feedback adm-nq-feedback--${feedback.type}`}>
              {feedback.msg}
            </span>
          )}
          <button
            onClick={saveNextQuiz}
            disabled={saving || !nextQuizValue}
            className="adm-btn-primary-sm"
          >
            {saving ? 'Lagrer…' : 'Lagre'}
          </button>
        </div>

        {/* Recent quizzes */}
        {recentQuizzes.length > 0 && (
          <div className="adm-section">
            <p className="adm-section-label">Siste quizer</p>
            {recentQuizzes.map(quiz => (
              <div key={quiz.id} className="adm-quiz-row">
                <span className="adm-quiz-name">{quiz.title}</span>
                <div className="adm-quiz-right">
                  <span className={`adm-badge ${quiz.is_active ? 'adm-badge--open' : 'adm-badge--hidden'}`}>
                    {quiz.is_active ? '● Åpen' : 'Skjult'}
                  </span>
                  <Link
                    href={quiz.is_active ? `/leaderboard/${quiz.id}` : `/admin/quizzes/${quiz.id}`}
                    className="adm-quiz-link"
                  >
                    {quiz.is_active ? 'Toppliste →' : 'Rediger →'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sesong-toppliste */}
        <div className="adm-section">
          <p className="adm-section-label">Sesong-toppliste</p>
          <p style={{ fontSize: 12, color: 'var(--hint)', marginBottom: 12, lineHeight: 1.5 }}>
            Nullstilling sletter alle season_scores og setter season_points_awarded = false på quizer.
            Ved neste cron-kjøring fylles data inn igjen for alle stengte quizer.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => { setResetModal('all'); setResetInput('') }}
              style={{ fontSize: 13, fontWeight: 500, color: '#f87171', background: 'transparent', border: '0.5px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', transition: 'background 0.15s', fontFamily: "'Instrument Sans', sans-serif" }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              Nullstill all data
            </button>
            <button
              onClick={() => { setResetModal('test'); setResetInput('') }}
              className="adm-btn-outline"
            >
              Nullstill kun testdata
            </button>
            {resetDone && (
              <span style={{ fontSize: 12, color: '#4ade80', background: 'rgba(74,222,128,0.08)', padding: '4px 10px', borderRadius: 6 }}>
                {resetDone}
              </span>
            )}
          </div>
        </div>

        {/* Nav grid */}
        <div className="adm-nav">
          <Link href="/admin/quizzes" className="adm-nav-card">
            <div>
              <p className="adm-nav-title">Administrer quizer</p>
              <p className="adm-nav-desc">Se, rediger og publiser</p>
            </div>
            <span className="adm-nav-arrow">→</span>
          </Link>
          <Link href="/admin/quizzes/new" className="adm-nav-card">
            <div>
              <p className="adm-nav-title">Lag ny quiz</p>
              <p className="adm-nav-desc">Opprett ny fredagsquiz</p>
            </div>
            <span className="adm-nav-arrow">→</span>
          </Link>
          <Link href="/admin/codes" className="adm-nav-card">
            <div>
              <p className="adm-nav-title">Verdikoder</p>
              <p className="adm-nav-desc">Lag og administrer koder</p>
            </div>
            <span className="adm-nav-arrow">→</span>
          </Link>
          <div className="adm-nav-card adm-nav-card--disabled">
            <div>
              <p className="adm-nav-title adm-nav-title--muted">Kommer snart</p>
              <p className="adm-nav-desc">Abonnenter og B2B</p>
            </div>
          </div>
        </div>

      </div>

      {/* Reset-modal */}
      {resetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px 28px', maxWidth: 420, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>
              {resetModal === 'all' ? 'Nullstill all sesong-data' : 'Nullstill testdata'}
            </p>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20 }}>
              {resetModal === 'all'
                ? 'Dette sletter ALLE season_scores og resetter alle quizer. Handlingen kan ikke angres.'
                : 'Dette sletter season_scores for quizer med "test" i tittelen.'}
            </p>
            <p style={{ fontSize: 12, color: '#7a7873', marginBottom: 8 }}>Skriv <strong style={{ color: '#e8e4dd' }}>NULLSTILL</strong> for å bekrefte:</p>
            <input
              type="text"
              value={resetInput}
              onChange={e => setResetInput(e.target.value)}
              placeholder="NULLSTILL"
              autoFocus
              style={{ width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none', marginBottom: 16, boxSizing: 'border-box' }}
              onKeyDown={e => { if (e.key === 'Enter') handleReset() }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setResetModal(null); setResetInput('') }}
                className="adm-btn-outline"
                style={{ padding: '8px 16px' }}
              >
                Avbryt
              </button>
              <button
                onClick={handleReset}
                disabled={resetInput !== 'NULLSTILL' || resetting}
                style={{ fontSize: 13, fontWeight: 600, color: resetInput === 'NULLSTILL' ? '#0f0f10' : '#7a7873', background: resetInput === 'NULLSTILL' ? '#f87171' : '#2a2d38', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: resetInput === 'NULLSTILL' ? 'pointer' : 'not-allowed', fontFamily: "'Instrument Sans', sans-serif", transition: 'background 0.15s, color 0.15s' }}
              >
                {resetting ? 'Nullstiller…' : 'Nullstill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
