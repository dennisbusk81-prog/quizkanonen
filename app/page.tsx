import { supabaseAdmin } from '@/lib/supabase-admin'
import QuizCountdown from '@/components/QuizCountdown'
import PendingActionRedirect from '@/components/PendingActionRedirect'
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
  const [{ data: quizzes }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from('quizzes')
      .select('id, title, allow_teams, requires_access_code, time_limit_seconds, questions(count), attempts(count)')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', 'next_quiz_at')
      .single(),
  ])

  const quizList = (quizzes as QuizRow[] | null) ?? []
  const nextQuizAt: string | null = settings?.value ?? null

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

        /* Slik fungerer det */
        .qk-how-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 12px;
        }

        .qk-how-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 22px 18px;
        }

        .qk-how-num {
          font-family: 'Libre Baskerville', serif;
          font-size: 28px;
          font-weight: 700;
          color: var(--gold);
          opacity: 0.6;
          line-height: 1;
          margin-bottom: 12px;
        }

        .qk-how-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--white);
          margin-bottom: 6px;
        }

        .qk-how-desc {
          font-size: 12px;
          color: var(--muted);
          line-height: 1.55;
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
          flex-wrap: wrap;
        }

        .qk-footer-link {
          font-size: 12px;
          color: var(--muted);
          text-decoration: none;
          transition: color 0.15s;
        }

        .qk-footer-link:hover { color: var(--gold); }

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

        .qk-nav-logo em {
          font-style: italic;
          color: var(--gold);
        }

        .qk-nav-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .qk-nav-login {
          font-size: 13px;
          font-weight: 500;
          color: var(--body);
          text-decoration: none;
          padding: 6px 14px;
          border-radius: var(--radius-btn);
          border: 1px solid var(--border);
          transition: border-color 0.15s, color 0.15s;
          white-space: nowrap;
        }

        .qk-nav-login:hover {
          border-color: rgba(201,168,76,0.35);
          color: var(--gold);
        }

        .qk-nav-play {
          font-size: 13px;
          font-weight: 600;
          color: #0f0f10;
          background: var(--gold);
          text-decoration: none;
          padding: 6px 14px;
          border-radius: var(--radius-btn);
          white-space: nowrap;
          transition: background 0.15s;
        }

        .qk-nav-play:hover { background: #d9b85c; }

        /* ── Hero ── */
        .qk-hero {
          padding: 56px 0 40px;
        }

        .qk-live-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: #4caf7d;
          background: rgba(76,175,77,0.10);
          border: 1px solid rgba(76,175,77,0.25);
          border-radius: 20px;
          padding: 4px 12px;
          margin-bottom: 14px;
        }

        .qk-hero-title {
          font-family: 'Libre Baskerville', serif;
          font-size: clamp(26px, 5.5vw, 42px);
          font-weight: 700;
          color: var(--white);
          line-height: 1.18;
          letter-spacing: -0.02em;
          margin: 10px 0 18px;
          max-width: 540px;
        }

        .qk-hero-title em {
          font-style: italic;
          color: var(--gold);
        }

        .qk-hero-body {
          font-size: 15px;
          color: var(--body);
          line-height: 1.65;
          max-width: 480px;
          margin-bottom: 28px;
        }

        .qk-hero-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 14px;
        }

        .qk-btn-secondary {
          font-size: 14px;
          font-weight: 600;
          color: var(--gold);
          text-decoration: none;
          padding: 10px 20px;
          border-radius: var(--radius-btn);
          border: 1px solid rgba(201,168,76,0.35);
          transition: background 0.15s, border-color 0.15s;
          white-space: nowrap;
        }

        .qk-btn-secondary:hover {
          background: rgba(201,168,76,0.08);
          border-color: rgba(201,168,76,0.55);
        }

        .qk-reassurance {
          font-size: 12px;
          color: var(--muted);
        }

        .qk-hero-rule {
          width: 100%;
          height: 1px;
          background: var(--border);
          margin-top: 40px;
        }

        /* ── Hva er inkludert ── */
        .qk-pricing {
          margin-bottom: 4px;
          margin-top: -20px;
        }

        .qk-pricing-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          align-items: stretch;
        }

        .qk-pricing-col {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 16px 14px;
          display: flex;
          flex-direction: column;
        }

        .qk-pricing-col--premium {
          background: #1c1f2b;
          border-color: rgba(201,168,76,0.3);
        }

        .qk-pricing-tier {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 2px;
        }

        .qk-pricing-tier--muted   { color: var(--muted); }
        .qk-pricing-tier--free    { color: var(--white); }
        .qk-pricing-tier--premium { color: var(--gold); }

        .qk-pricing-price {
          font-family: 'Libre Baskerville', serif;
          font-size: 16px;
          font-weight: 700;
          color: var(--gold);
          margin-bottom: 10px;
        }

        .qk-pricing-head-spacer {
          margin-bottom: 10px;
        }

        .qk-pricing-list {
          list-style: none;
          padding: 0;
          margin: 0 0 12px;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .qk-pricing-item {
          font-size: 13px;
          line-height: 1.4;
        }

        .qk-pricing-item--yes     { color: var(--body); }
        .qk-pricing-item--no      { color: var(--muted); opacity: 0.55; }
        .qk-pricing-item--premium { color: var(--gold); }

        .qk-pricing-btn {
          display: block;
          padding: 8px 14px;
          border-radius: var(--radius-btn);
          font-family: 'Instrument Sans', sans-serif;
          font-size: 13px;
          font-weight: 700;
          text-align: center;
          text-decoration: none;
          margin-bottom: 6px;
          transition: opacity 0.15s, background 0.15s, border-color 0.15s, color 0.15s;
        }

        .qk-pricing-btn--free {
          background: transparent;
          color: var(--white);
          border: 1px solid rgba(255,255,255,0.18);
        }

        .qk-pricing-btn--free:hover {
          border-color: rgba(201,168,76,0.55);
          color: var(--gold);
        }

        .qk-pricing-btn--premium {
          background: var(--gold);
          color: #0f0f10;
          border: 1px solid transparent;
        }

        .qk-pricing-btn--premium:hover { opacity: 0.88; }

        .qk-pricing-sub {
          font-size: 11px;
          color: var(--muted);
          text-align: center;
        }

        @media (max-width: 520px) {
          .qk-card { flex-direction: column; gap: 16px; }
          .qk-card-right { flex-direction: row; width: 100%; justify-content: flex-start; }
          .qk-header { padding: 40px 0 32px; }
          .qk-how-grid { grid-template-columns: 1fr; }
          .qk-pricing-grid { grid-template-columns: 1fr; }
          .qk-nav-play { display: none; }
          .qk-hero { padding: 36px 0 28px; }
        }
      `}</style>

      <PendingActionRedirect />

      <nav className="qk-nav">
        <div className="qk-nav-inner">
          <a href="/" className="qk-nav-logo">Quiz<em>kanonen</em></a>
          <div className="qk-nav-actions">
            <Link href="/login" className="qk-nav-login">Logg inn gratis</Link>
            {quizList.length > 0 && (
              <Link href={`/quiz/${quizList[0].id}`} className="qk-nav-play">
                Spill ukens quiz →
              </Link>
            )}
          </div>
        </div>
      </nav>

      <div className="qk-page">

        <section className="qk-hero">
          {quizList.length > 0 && (
            <div><span className="qk-live-badge">● Fredagsquizen er åpen nå</span></div>
          )}
          <p className="qk-eyebrow">Den ukentlige quizen</p>
          <h1 className="qk-hero-title">
            Fredagsquizen der du <em>følger med over tid.</em>
          </h1>
          <p className="qk-hero-body">
            Spill gratis — ingen konto nødvendig. Logg inn for å se nøyaktig plassering og følge fremgangen din uke etter uke. Ny quiz hver fredag.
          </p>
          <div className="qk-hero-actions">
            {quizList.length > 0 && (
              <Link href={`/quiz/${quizList[0].id}`} className="qk-btn-play">
                <svg width="11" height="12" viewBox="0 0 11 12" fill="#0f0f10" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1.5L10 6 1 10.5V1.5Z" />
                </svg>
                Spill ukens quiz
              </Link>
            )}
            {FOUNDERS_ACTIVE && (
              <Link href="/founders" className="qk-btn-secondary">Prøv én måned gratis →</Link>
            )}
          </div>
          <p className="qk-reassurance"><strong>Ingen kortinfo. Ingen spam. Bare quiz.</strong> · Avslutt når du vil.</p>
          <div className="qk-hero-rule" />
        </section>

        {/* Hva er inkludert */}
        <section className="qk-pricing">
          <div className="qk-section">
            <span className="qk-section-text">Hva er inkludert</span>
            <div className="qk-section-line" />
          </div>

          <div className="qk-pricing-grid">

            {/* Kolonne 1 — Uten konto */}
            <div className="qk-pricing-col">
              <p className="qk-pricing-tier qk-pricing-tier--muted">Uten konto</p>
              <div className="qk-pricing-head-spacer" />
              <ul className="qk-pricing-list">
                <li className="qk-pricing-item qk-pricing-item--yes">✓ Spill quizen</li>
                <li className="qk-pricing-item qk-pricing-item--yes">✓ Se omtrentlig plassering</li>
                <li className="qk-pricing-item qk-pricing-item--no">– Fast spillernavn</li>
                <li className="qk-pricing-item qk-pricing-item--no">– Nøyaktig plassering</li>
                <li className="qk-pricing-item qk-pricing-item--no">– Historikk</li>
                <li className="qk-pricing-item qk-pricing-item--no">– Private ligaer</li>
              </ul>
            </div>

            {/* Kolonne 2 — Innlogget gratis */}
            <div className="qk-pricing-col">
              <p className="qk-pricing-tier qk-pricing-tier--free">Innlogget — gratis</p>
              <div className="qk-pricing-head-spacer" />
              <ul className="qk-pricing-list">
                <li className="qk-pricing-item qk-pricing-item--yes">✓ Spill quizen</li>
                <li className="qk-pricing-item qk-pricing-item--yes">✓ Du huskes på topplisten</li>
                <li className="qk-pricing-item qk-pricing-item--yes">✓ Fast spillernavn</li>
                <li className="qk-pricing-item qk-pricing-item--yes">✓ Nøyaktig plassering</li>
                <li className="qk-pricing-item qk-pricing-item--no">– Historikk</li>
                <li className="qk-pricing-item qk-pricing-item--no">– Private ligaer</li>
              </ul>
              <Link href="/auth/callback" className="qk-pricing-btn qk-pricing-btn--free">
                Logg inn med Google
              </Link>
              <p className="qk-pricing-sub">Ingen kortinfo nødvendig</p>
            </div>

            {/* Kolonne 3 — Premium */}
            <div className="qk-pricing-col qk-pricing-col--premium">
              <p className="qk-pricing-tier qk-pricing-tier--premium">Premium</p>
              <p className="qk-pricing-price">kr 49/mnd</p>
              <ul className="qk-pricing-list">
                <li className="qk-pricing-item qk-pricing-item--premium">✦ Alt fra innlogget</li>
                <li className="qk-pricing-item qk-pricing-item--premium">✦ Quizhistorikk og statistikk</li>
                <li className="qk-pricing-item qk-pricing-item--premium">✦ Følg din utvikling</li>
                <li className="qk-pricing-item qk-pricing-item--premium">✦ Private ligaer</li>
                <li className="qk-pricing-item qk-pricing-item--premium">✦ XP og rangtitler</li>
                <li className="qk-pricing-item qk-pricing-item--premium">✦ Avslutt når du vil</li>
              </ul>
              <Link href="/founders" className="qk-pricing-btn qk-pricing-btn--premium">
                Prøv gratis i 1 måned
              </Link>
              <p className="qk-pricing-sub">Ingen kortinfo nødvendig</p>
            </div>

          </div>
        </section>

        <QuizCountdown initialDate={nextQuizAt} />

        <div className="qk-section">
          <span className="qk-section-text">Tilgjengelig nå</span>
          <div className="qk-section-line" />
        </div>

        {quizList.length === 0 ? (
          <div className="qk-empty">
            <div className="qk-empty-icon">🏔️</div>
            <p className="qk-empty-title">Ingen aktive quizer akkurat nå</p>
            <p className="qk-empty-sub">
              Ny quiz legges ut hver fredag.<br />
              Følg med i Facebook-gruppen for varsling.
            </p>
          </div>
        ) : (
          quizList.map(quiz => {
            const questionCount = quiz.questions[0]?.count ?? 0
            const participantCount = quiz.attempts[0]?.count ?? 0
            return (
              <div key={quiz.id} className="qk-card">
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
                      <span className="qk-detail">👥 {participantCount} deltakere</span>
                    )}
                    {quiz.time_limit_seconds && (
                      <span className="qk-detail">⏱ {quiz.time_limit_seconds}s per spørsmål</span>
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
            )
          })
        )}

        <div className="qk-section" style={{ marginTop: 48 }}>
          <span className="qk-section-text">Slik fungerer det</span>
          <div className="qk-section-line" />
        </div>

        <div className="qk-how-grid">
          {[
            { num: '1', title: 'Åpne quizen', desc: 'Velg en aktiv quiz og skriv inn navnet ditt for å starte.' },
            { num: '2', title: 'Svar på spørsmål', desc: 'Svar raskt — du har begrenset tid per spørsmål.' },
            { num: '3', title: 'Se rangeringen', desc: 'Sjekk topplisten og se hvor du havnet blant alle deltakerne.' },
          ].map(({ num, title, desc }) => (
            <div key={num} className="qk-how-card">
              <div className="qk-how-num">{num}</div>
              <p className="qk-how-title">{title}</p>
              <p className="qk-how-desc">{desc}</p>
            </div>
          ))}
        </div>

        <footer className="qk-footer">
          <span suppressHydrationWarning className="qk-footer-brand">Quizkanonen &copy; {new Date().getFullYear()}</span>
          <nav className="qk-footer-nav">
            <a href="https://facebook.com" target="_blank" rel="noopener" className="qk-footer-link">Facebook</a>
            <Link href="/personvern" className="qk-footer-link">Personvern</Link>
            <Link href="/vilkar" className="qk-footer-link">Vilkår</Link>
            <a href="mailto:quizkanonen@gmail.com" className="qk-footer-link">Kontakt</a>
          </nav>
        </footer>

      </div>
    </>
  )
}
