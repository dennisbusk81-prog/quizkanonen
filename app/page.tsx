'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, Quiz } from '@/lib/supabase'

export default function Home() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchQuizzes()
  }, [])

  async function fetchQuizzes() {
    const { data } = await supabase
      .from('quizzes')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    setQuizzes(data || [])
    setLoading(false)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:       #1a1c23;
          --card:     #21242e;
          --border:   #2a2d38;
          --gold:     #c9a84c;
          --white:    #ffffff;
          --body:     #9a9590;
          --muted:    #6a6860;
          --radius-card: 20px;
          --radius-btn:  10px;
        }

        body {
          background: var(--bg);
          font-family: 'Instrument Sans', sans-serif;
          color: var(--body);
          min-height: 100vh;
        }

        .qk-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 0 20px 80px;
        }

        .qk-header {
          padding: 56px 0 48px;
        }

        .qk-eyebrow {
          font-family: 'Instrument Sans', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 14px;
        }

        .qk-logo {
          font-family: 'Libre Baskerville', serif;
          font-size: clamp(36px, 8vw, 52px);
          font-weight: 700;
          color: var(--white);
          line-height: 1.08;
          letter-spacing: -0.02em;
        }

        .qk-logo em {
          font-style: italic;
          color: var(--gold);
        }

        .qk-sub {
          margin-top: 18px;
          font-size: 15px;
          color: var(--body);
          line-height: 1.6;
          max-width: 420px;
        }

        .qk-rule {
          width: 100%;
          height: 1px;
          background: var(--border);
          margin-top: 40px;
        }

        .qk-section {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 36px 0 20px;
        }

        .qk-section-text {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--muted);
          white-space: nowrap;
        }

        .qk-section-line {
          flex: 1;
          height: 1px;
          background: var(--border);
        }

        .qk-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 28px;
          margin-bottom: 12px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          position: relative;
          overflow: hidden;
          transition: border-color 0.18s, transform 0.18s;
        }

        .qk-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(201,168,76,0.04) 0%, transparent 60%);
          opacity: 0;
          transition: opacity 0.18s;
          pointer-events: none;
        }

        .qk-card:hover {
          border-color: rgba(201,168,76,0.35);
          transform: translateY(-2px);
        }

        .qk-card:hover::before {
          opacity: 1;
        }

        .qk-card-left {
          flex: 1;
          min-width: 0;
        }

        .qk-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 10px;
        }

        .qk-tag {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 3px 9px;
          border-radius: 20px;
          background: rgba(201,168,76,0.10);
          color: var(--gold);
          border: 1px solid rgba(201,168,76,0.22);
        }

        .qk-tag-muted {
          background: rgba(106,104,96,0.12);
          color: var(--muted);
          border: 1px solid rgba(106,104,96,0.18);
        }

        .qk-title {
          font-family: 'Libre Baskerville', serif;
          font-size: 19px;
          font-weight: 700;
          color: var(--white);
          line-height: 1.25;
          margin-bottom: 10px;
          letter-spacing: -0.01em;
        }

        .qk-details {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        .qk-detail {
          font-size: 12px;
          color: var(--muted);
        }

        .qk-card-right {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
        }

        .qk-btn-play {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: var(--gold);
          color: #0f0f10;
          font-family: 'Instrument Sans', sans-serif;
          font-size: 13px;
          font-weight: 600;
          padding: 10px 18px;
          border-radius: var(--radius-btn);
          text-decoration: none;
          white-space: nowrap;
          transition: background 0.15s, transform 0.12s;
        }

        .qk-btn-play:hover {
          background: #d9b85c;
          transform: scale(1.03);
        }

        .qk-btn-ghost {
          font-size: 12px;
          font-weight: 500;
          color: var(--muted);
          text-decoration: none;
          transition: color 0.15s;
          padding: 4px 0;
        }

        .qk-btn-ghost:hover {
          color: var(--gold);
        }

        .qk-empty {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 56px 32px;
          text-align: center;
        }

        .qk-empty-icon {
          font-size: 40px;
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .qk-empty-title {
          font-family: 'Libre Baskerville', serif;
          font-size: 20px;
          color: var(--white);
          margin-bottom: 8px;
        }

        .qk-empty-sub {
          font-size: 14px;
          color: var(--muted);
          line-height: 1.6;
        }

        .qk-skeleton {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 28px;
          margin-bottom: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .qk-shimmer {
          background: linear-gradient(90deg, var(--border) 25%, #2f3340 50%, var(--border) 75%);
          background-size: 400% 100%;
          animation: shimmer 1.6s ease infinite;
          border-radius: 6px;
        }

        @keyframes shimmer {
          0%   { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }

        .qk-footer {
          margin-top: 64px;
          padding-top: 28px;
          border-top: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
        }

        .qk-footer-brand {
          font-family: 'Libre Baskerville', serif;
          font-size: 14px;
          color: var(--muted);
          font-style: italic;
        }

        .qk-footer-nav {
          display: flex;
          gap: 20px;
        }

        .qk-footer-link {
          font-size: 12px;
          color: var(--muted);
          text-decoration: none;
          transition: color 0.15s;
        }

        .qk-footer-link:hover { color: var(--gold); }

        @media (max-width: 520px) {
          .qk-card { flex-direction: column; gap: 16px; }
          .qk-card-right { flex-direction: row; width: 100%; justify-content: flex-start; }
          .qk-header { padding: 40px 0 32px; }
        }
      `}</style>

      <div className="qk-page">

        <header className="qk-header">
          <p className="qk-eyebrow">Den ukentlige quizen</p>
          <h1 className="qk-logo">Quiz<em>kanonen</em></h1>
          <p className="qk-sub">Ukentlige quizer for deg som liker å utfordre kunnskapen sin — og andre.</p>
          <div className="qk-rule" />
        </header>

        <div className="qk-section">
          <span className="qk-section-text">Tilgjengelig nå</span>
          <div className="qk-section-line" />
        </div>

        {loading ? (
          <>
            {[1, 2].map(i => (
              <div key={i} className="qk-skeleton">
                <div className="qk-shimmer" style={{ height: 12, width: '30%' }} />
                <div className="qk-shimmer" style={{ height: 22, width: '70%' }} />
                <div className="qk-shimmer" style={{ height: 12, width: '45%' }} />
              </div>
            ))}
          </>
        ) : quizzes.length === 0 ? (
          <div className="qk-empty">
            <div className="qk-empty-icon">🏔️</div>
            <p className="qk-empty-title">Ingen aktive quizer akkurat nå</p>
            <p className="qk-empty-sub">
              Ny quiz legges ut hver fredag.<br />
              Følg med i Facebook-gruppen for varsling.
            </p>
          </div>
        ) : (
          quizzes.map(quiz => (
            <div key={quiz.id} className="qk-card">
              <div className="qk-card-left">
                <div className="qk-tags">
                  <span className="qk-tag">● Åpen</span>
                  {quiz.allow_teams && <span className="qk-tag qk-tag-muted">👥 Lag</span>}
                  {quiz.requires_access_code && <span className="qk-tag qk-tag-muted">🔒 Kode</span>}
                </div>

                <h2 className="qk-title">{quiz.title}</h2>

                <div className="qk-details">
                  {quiz.time_limit_seconds && (
                    <span className="qk-detail">⏱ {quiz.time_limit_seconds}s per spørsmål</span>
                  )}
                  {quiz.num_options && (
                    <span className="qk-detail">{quiz.num_options} alternativer</span>
                  )}
                </div>
              </div>

              <div className="qk-card-right">
                <Link href={`/quiz/${quiz.id}`} className="qk-btn-play">
                  <svg width="11" height="12" viewBox="0 0 11 12" fill="#0f0f10" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 1.5L10 6 1 10.5V1.5Z" />
                  </svg>
                  Spill nå
                </Link>
                <Link href={`/leaderboard/${quiz.id}`} className="qk-btn-ghost">
                  Toppliste ↗
                </Link>
              </div>
            </div>
          ))
        )}

        <footer className="qk-footer">
          <span className="qk-footer-brand">Quizkanonen &copy; {new Date().getFullYear()}</span>
          <nav className="qk-footer-nav">
            <a href="https://facebook.com" target="_blank" rel="noopener" className="qk-footer-link">Facebook-gruppen</a>
            <Link href="/admin" className="qk-footer-link">Admin</Link>
          </nav>
        </footer>

      </div>
    </>
  )
}