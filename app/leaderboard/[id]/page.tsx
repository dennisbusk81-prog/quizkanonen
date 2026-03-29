'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, Quiz, Attempt } from '@/lib/supabase'
import { rankAttempts, getMedal } from '@/lib/ranking'
import Link from 'next/link'

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
  }
`

export default function LeaderboardPage() {
  const params = useParams()
  const quizId = params.id as string
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const { data: quizData } = await supabase.from('quizzes').select('*').eq('id', quizId).single()
      const { data: attemptData } = await supabase
        .from('attempts').select('*').eq('quiz_id', quizId).limit(200)
      setQuiz(quizData)
      setAttempts(attemptData || [])
      setLoading(false)
    }
    fetchData()
  }, [quizId])

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
      <div className="lb-page">

        <header className="lb-header">
          <Link href="/" className="lb-back">← Tilbake til forsiden</Link>
          <p className="lb-eyebrow">Quizkanonen</p>
          <h1 className="lb-title">Quiz<em>kanonen</em></h1>
          <p className="lb-subtitle">{quiz.title}</p>
          <div className="lb-rule" />
        </header>

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