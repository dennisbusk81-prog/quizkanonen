import { supabaseAdmin } from '@/lib/supabase-admin'
import PendingActionRedirect from '@/components/PendingActionRedirect'
import NavAuth from '@/components/NavAuth'
import AccordionSection from '@/components/AccordionSection'
import LoginCTAButton from '@/components/LoginCTAButton'
import Link from 'next/link'

const FOUNDERS_ACTIVE = true

export const dynamic = 'force-dynamic'

type QuizRow = {
  id: string
  title: string
  allow_teams: boolean
  requires_access_code: boolean
  time_limit_seconds: number | null
  questions: { count: number }[]
  attempts: { count: number }[]
}

export default async function Home() {
  const [{ data: quizzes }, { data: lastQuiz }] = await Promise.all([
    supabaseAdmin
      .from('quizzes')
      .select('id, title, allow_teams, requires_access_code, time_limit_seconds, questions(count), attempts(count)')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('quizzes')
      .select('attempts(count)')
      .eq('is_active', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const quizList = (quizzes as QuizRow[] | null) ?? []
  const lastParticipants: number | null = (lastQuiz as { attempts: { count: number }[] } | null)?.attempts?.[0]?.count ?? null

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
          --body:     #e8e4dd;
          --hint:     #7a7873;
          --muted:    #6a6860;
          --green:    #7ab87a;
          --radius-card: 16px;
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

        /* ── Nav ── */
        .qk-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(26,28,35,0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
        }

        .qk-nav-inner {
          max-width: 720px;
          margin: 0 auto;
          padding: 0 20px;
          height: 54px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .qk-nav-logo {
          font-family: 'Libre Baskerville', serif;
          font-size: 17px;
          font-weight: 700;
          color: var(--white);
          text-decoration: none;
          flex-shrink: 0;
        }

        .qk-nav-logo em { font-style: italic; color: var(--gold); }

        .qk-nav-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .qk-nav-play {
          font-size: 13px;
          font-weight: 600;
          color: var(--body);
          background: transparent;
          text-decoration: none;
          padding: 6px 14px;
          border-radius: var(--radius-btn);
          border: 0.5px solid #4a4d5a;
          white-space: nowrap;
          transition: border-color 0.15s, color 0.15s;
        }

        .qk-nav-play:hover {
          border-color: var(--gold);
          color: var(--gold);
        }

        /* ── Hero ── */
        .qk-hero {
          padding: 56px 0 40px;
          text-align: center;
        }

        @media (min-width: 641px) {
          .qk-hero { text-align: left; }
          .qk-hero-actions { justify-content: flex-start; }
          .qk-hero-status { justify-content: flex-start; }
        }

        .qk-hero-title {
          font-family: 'Libre Baskerville', serif;
          font-size: clamp(28px, 6vw, 44px);
          font-weight: 700;
          color: var(--white);
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin-bottom: 24px;
          max-width: 540px;
        }

        .qk-hero-title em { font-style: italic; color: var(--gold); }

        .qk-hero-actions {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 10px;
        }

        .qk-btn-primary {
          display: inline-flex;
          align-items: center;
          width: auto;
          background: var(--gold);
          color: #1a1c23;
          font-family: 'Instrument Sans', sans-serif;
          font-size: 15px;
          font-weight: 700;
          padding: 10px 28px;
          border-radius: var(--radius-btn);
          text-decoration: none;
          white-space: nowrap;
          transition: background 0.15s;
        }

        .qk-btn-primary:hover { background: #d9b85c; }

        .qk-hero-hint {
          font-size: 13px;
          color: var(--hint);
          margin-bottom: 12px;
        }

        .qk-hero-status {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 5px;
          font-size: 13px;
          color: var(--hint);
        }

        .qk-status-free { color: var(--green); font-weight: 600; }
        .qk-status-premium { color: var(--gold); font-weight: 600; }

        /* ── Social proof ── */
        .qk-social {
          text-align: center;
          font-size: 14px;
          color: var(--hint);
          font-style: italic;
          padding: 16px 0 28px;
        }

        /* ── Section divider ── */
        .qk-section {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 32px 0 16px;
        }

        .qk-section-text {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--muted);
          white-space: nowrap;
        }

        .qk-section-line { flex: 1; height: 1px; background: var(--border); }

        /* ── Quiz card ── */
        .qk-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 14px 18px;
          margin-bottom: 8px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          transition: border-color 0.18s;
        }

        .qk-card:hover { border-color: rgba(201,168,76,0.3); }

        .qk-card-left { flex: 1; min-width: 0; }

        .qk-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }

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

        .qk-details { display: flex; flex-wrap: wrap; gap: 12px; }
        .qk-detail { font-size: 12px; color: var(--hint); }

        .qk-card-right {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
        }

        .qk-btn-outline {
          display: inline-flex;
          align-items: center;
          background: transparent;
          color: var(--body);
          font-family: 'Instrument Sans', sans-serif;
          font-size: 13px;
          font-weight: 600;
          padding: 9px 18px;
          border-radius: var(--radius-btn);
          border: 0.5px solid #4a4d5a;
          text-decoration: none;
          white-space: nowrap;
          transition: border-color 0.15s, color 0.15s;
        }

        .qk-btn-outline:hover { border-color: var(--body); color: var(--white); }

        .qk-btn-ghost {
          font-size: 12px;
          font-weight: 500;
          color: var(--hint);
          text-decoration: none;
          transition: color 0.15s;
          padding: 4px 0;
        }

        .qk-btn-ghost:hover { color: var(--gold); }

        /* ── Empty state ── */
        .qk-empty {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 48px 32px;
          text-align: center;
          margin-bottom: 12px;
        }

        .qk-empty-icon { font-size: 36px; margin-bottom: 14px; opacity: 0.5; }

        .qk-empty-title {
          font-family: 'Libre Baskerville', serif;
          font-size: 18px;
          color: var(--white);
          margin-bottom: 8px;
        }

        .qk-empty-sub { font-size: 13px; color: var(--hint); line-height: 1.6; }

        /* ── Founders ── */
        .qk-founders {
          background: #1e1a0e;
          border: 1px solid rgba(201,168,76,0.28);
          border-radius: var(--radius-card);
          padding: 32px 28px;
          margin-bottom: 10px;
        }

        .qk-founders-eyebrow {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 10px;
        }

        .qk-founders-title {
          font-family: 'Libre Baskerville', serif;
          font-size: clamp(18px, 4vw, 22px);
          font-weight: 700;
          color: var(--white);
          line-height: 1.25;
          letter-spacing: -0.01em;
          margin-bottom: 10px;
        }

        .qk-founders-sub {
          font-size: 14px;
          color: var(--body);
          line-height: 1.6;
          margin-bottom: 20px;
        }

        .qk-founders-btn {
          display: inline-block;
          padding: 10px 24px;
          border: 1px solid var(--gold);
          border-radius: var(--radius-btn);
          color: var(--gold);
          font-family: 'Instrument Sans', sans-serif;
          font-size: 14px;
          font-weight: 700;
          text-decoration: none;
          transition: background 0.15s;
        }

        .qk-founders-btn:hover { background: rgba(201,168,76,0.08); }

        /* ── Verdikort ── */
        .qk-value-stack {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          align-items: stretch;
        }

        .qk-value-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 24px;
          display: flex;
          flex-direction: column;
        }

        .qk-value-card--premium { border-color: rgba(201,168,76,0.3); }

        .qk-value-tier {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }

        .qk-value-tier--free { color: var(--white); }
        .qk-value-tier--premium { color: var(--gold); }

        .qk-value-price {
          font-family: 'Libre Baskerville', serif;
          font-size: 15px;
          font-weight: 700;
          color: var(--gold);
          margin-bottom: 14px;
        }

        .qk-value-list {
          list-style: none;
          padding: 0;
          margin: 0 0 18px;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .qk-value-item { font-size: 14px; color: var(--body); line-height: 1.4; }
        .qk-value-item--premium { color: var(--gold); }

        .qk-value-btn {
          display: inline-block;
          padding: 9px 22px;
          background: transparent;
          border: 1px solid var(--gold);
          color: var(--gold);
          font-family: 'Instrument Sans', sans-serif;
          font-size: 14px;
          font-weight: 700;
          border-radius: var(--radius-btn);
          text-decoration: none;
          transition: background 0.15s;
        }

        .qk-value-btn:hover { background: rgba(201,168,76,0.08); }

        .qk-all-link {
          display: inline-block;
          font-size: 13px;
          color: var(--gold);
          text-decoration: none;
          margin-top: 12px;
          margin-bottom: 8px;
          transition: opacity 0.15s;
        }

        .qk-all-link:hover { opacity: 0.75; }

        /* ── Responsive ── */
        @media (max-width: 520px) {
          .qk-card { flex-direction: column; gap: 16px; }
          .qk-card-right { flex-direction: row; width: 100%; justify-content: flex-start; }
          .qk-hero { padding: 36px 0 28px; }
          .qk-nav-play { display: none; }
          .qk-value-stack { grid-template-columns: 1fr; }
        }
      `}</style>

      <PendingActionRedirect />

      <nav className="qk-nav">
        <div className="qk-nav-inner">
          <a href="/" className="qk-nav-logo">Quiz<em>kanonen</em></a>
          <div className="qk-nav-actions">
            <NavAuth />
            {quizList.length > 0 && (
              <Link href={`/quiz/${quizList[0].id}`} className="qk-nav-play">
                Spill ukens quiz →
              </Link>
            )}
          </div>
        </div>
      </nav>

      <div className="qk-page">

        {/* Hero */}
        <section className="qk-hero">
          <h1 className="qk-hero-title">
            Fredagsquizen der du <em>følger med over tid.</em>
          </h1>
          <div className="qk-hero-actions">
            {quizList.length > 0 && (
              <Link href={`/quiz/${quizList[0].id}`} className="qk-btn-primary">
                Spill ukens quiz
              </Link>
            )}
          </div>
          <p className="qk-hero-hint">Gratis — ingen konto nødvendig</p>
          <div className="qk-hero-status">
            <span className="qk-status-free">✓ Gratis</span>
            <span>·</span>
            <span className="qk-status-free">✓ Innlogget</span>
            <span>·</span>
            <span className="qk-status-premium">★ Premium kr 49/mnd</span>
          </div>
        </section>

        {/* Sosialt bevis */}
        {lastParticipants !== null && lastParticipants > 0 && (
          <p className="qk-social">{lastParticipants} spillere konkurrerte sist fredag.</p>
        )}

        {/* Aktiv quiz */}
        {quizList.length === 0 ? (
          <div className="qk-empty">
            <div className="qk-empty-icon">🏔️</div>
            <p className="qk-empty-title">Ingen aktive quizer akkurat nå</p>
            <p className="qk-empty-sub">
              Ny quiz legges ut hver fredag.<br />
              Følg med i Facebook-gruppen for varsling.
            </p>
          </div>
        ) : (() => {
          const quiz = quizList[0]
          const questionCount = quiz.questions[0]?.count ?? 0
          const participantCount = quiz.attempts[0]?.count ?? 0
          return (
            <>
              <div className="qk-card">
                <div className="qk-card-left">
                  <div className="qk-tags">
                    <span className="qk-tag">● Åpen</span>
                    {quiz.allow_teams && <span className="qk-tag qk-tag-muted">👥 Lag</span>}
                    {quiz.requires_access_code && <span className="qk-tag qk-tag-muted">🔒 Kode</span>}
                  </div>
                  <h2 className="qk-title">{quiz.title}</h2>
                  <div className="qk-details">
                    {questionCount > 0 && (
                      <span className="qk-detail">📋 {questionCount} spørsmål</span>
                    )}
                    {participantCount > 0 && (
                      <span className="qk-detail">👥 {participantCount} deltakere denne uken</span>
                    )}
                    {quiz.time_limit_seconds && (
                      <span className="qk-detail">⏱ {quiz.time_limit_seconds}s per spørsmål</span>
                    )}
                  </div>
                </div>
                <div className="qk-card-right">
                  <Link href={`/quiz/${quiz.id}`} className="qk-btn-outline">
                    Spill nå
                  </Link>
                  <Link href={`/leaderboard/${quiz.id}`} className="qk-btn-ghost">
                    Toppliste ↗
                  </Link>
                </div>
              </div>
              {quizList.length > 1 && (
                <Link href="/quizer" className="qk-all-link">Se alle aktive quizer →</Link>
              )}
            </>
          )
        })()}

        {/* Accordion */}
        <div style={{ marginTop: 36, marginBottom: 36 }}>
          <AccordionSection />
        </div>

        {/* Founders */}
        {FOUNDERS_ACTIVE && (
          <div className="qk-founders" style={{ marginBottom: 20 }}>
            <p className="qk-founders-eyebrow">Founders Access</p>
            <h2 className="qk-founders-title">Prøv Premium gratis i én måned</h2>
            <p className="qk-founders-sub">Ingen kortinfo. Ingen automatisk trekk. Vi minner deg på e-post før perioden utløper.</p>
            <Link href="/founders" className="qk-founders-btn">Aktiver gratis tilgang →</Link>
          </div>
        )}

        {/* Verdikort */}
        <div className="qk-value-stack" style={{ marginTop: 20 }}>
          <div className="qk-value-card">
            <p className="qk-value-tier qk-value-tier--free">Innlogget — gratis</p>
            <ul className="qk-value-list">
              <li className="qk-value-item">✓ Spill quizen</li>
              <li className="qk-value-item">✓ Du huskes på topplisten</li>
              <li className="qk-value-item">✓ Fast spillernavn</li>
              <li className="qk-value-item">✓ Nøyaktig plassering</li>
            </ul>
            <div style={{ marginTop: 'auto' }}>
              <LoginCTAButton />
            </div>
          </div>

          <div className="qk-value-card qk-value-card--premium">
            <p className="qk-value-tier qk-value-tier--premium">Premium</p>
            <p className="qk-value-price">kr 49/mnd</p>
            <ul className="qk-value-list">
              <li className="qk-value-item qk-value-item--premium">✦ Alt fra innlogget gratis</li>
              <li className="qk-value-item qk-value-item--premium">✦ Quizhistorikk og statistikk</li>
              <li className="qk-value-item qk-value-item--premium">✦ Følg din utvikling over tid</li>
              <li className="qk-value-item qk-value-item--premium">✦ Private ligaer</li>
              <li className="qk-value-item qk-value-item--premium">✦ XP og rangtitler</li>
              <li className="qk-value-item qk-value-item--premium">✦ Avslutt når du vil</li>
            </ul>
            <Link href="/founders" className="qk-value-btn">Prøv gratis i én måned</Link>
          </div>
        </div>


      </div>
    </>
  )
}
