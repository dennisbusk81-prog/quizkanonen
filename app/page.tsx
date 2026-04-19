import { supabaseAdmin } from '@/lib/supabase-admin'
import PendingActionRedirect from '@/components/PendingActionRedirect'
import NavAuth from '@/components/NavAuth'
import AccordionSection from '@/components/AccordionSection'
import Link from 'next/link'

const FOUNDERS_ACTIVE = true

export const dynamic = 'force-dynamic'

type QuizRow = {
  id: string
  title: string
  allow_teams: boolean
  requires_access_code: boolean
  time_limit_seconds: number | null
  opens_at: string | null
  closes_at: string | null
  questions: { count: number }[]
  attempts: { count: number }[]
}

type Top3Entry = {
  player_name: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
}

function formatNextQuiz(iso: string) {
  const d = new Date(iso)
  const weekday = d.toLocaleDateString('nb-NO', { weekday: 'long', timeZone: 'Europe/Oslo' })
  const day = d.toLocaleDateString('nb-NO', { day: 'numeric', timeZone: 'Europe/Oslo' })
  const month = d.toLocaleDateString('nb-NO', { month: 'long', timeZone: 'Europe/Oslo' })
  const time = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo', hour12: false })
  return `${weekday} ${day}. ${month} kl. ${time}`
}

function formatTimeSec(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function truncateName(name: string, max = 20): string {
  if (name.length <= max) return name
  return name.slice(0, max) + '…'
}

export default async function Home() {
  const now = new Date()

  const [{ data: quizzes }, { data: lastQuizData }, { data: nextQuizSetting }] = await Promise.all([
    supabaseAdmin
      .from('quizzes')
      .select('id, title, allow_teams, requires_access_code, time_limit_seconds, opens_at, closes_at, questions(count), attempts(count)')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('quizzes')
      .select('id')
      .lt('closes_at', now.toISOString())
      .order('closes_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', 'next_quiz_at')
      .maybeSingle(),
  ])

  const quizList = (quizzes as QuizRow[] | null) ?? []
  const lastQuizId: string | null = (lastQuizData as { id: string } | null)?.id ?? null
  const nextQuizAt: string | null = (nextQuizSetting as { value: string } | null)?.value ?? null

  let top3: Top3Entry[] = []
  if (lastQuizId) {
    const { data: top3Data } = await supabaseAdmin
      .from('attempts')
      .select('player_name, correct_answers, total_questions, total_time_ms')
      .eq('quiz_id', lastQuizId)
      .order('correct_answers', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .limit(3)
    top3 = (top3Data as Top3Entry[] | null) ?? []
  }

  const showTop3 = top3.length >= 1
  const medals = ['🥇', '🥈', '🥉']

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
          border: 0.5px solid #3a3d4a;
          white-space: nowrap;
          transition: border-color 0.15s, color 0.15s;
        }

        .qk-nav-play:hover {
          border-color: var(--gold);
          color: var(--gold);
        }

        /* ── Hero ── */
        .qk-hero {
          padding: 48px 24px 24px;
          text-align: center;
        }

        .qk-hero-title {
          font-family: 'Libre Baskerville', serif;
          font-size: clamp(28px, 6vw, 44px);
          font-weight: 700;
          color: var(--white);
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin: 0 auto 16px;
          max-width: 540px;
        }

        .qk-hero-title em { font-style: italic; color: var(--gold); }

        .qk-hero-subtitle {
          font-size: 16px;
          color: var(--body);
          opacity: 0.85;
          line-height: 1.6;
          text-align: center;
          margin: 0 auto 24px;
          max-width: 440px;
          padding: 0 16px;
        }

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

        .qk-hero-status {
          font-size: 13px;
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        /* ── Quote ── */
        .qk-quote {
          font-style: italic;
          font-size: 14px;
          color: var(--hint);
          text-align: center;
          max-width: 460px;
          margin: 0 auto 20px;
          line-height: 1.7;
          padding: 0 24px;
        }

        /* ── Facts ── */
        .qk-facts {
          display: flex;
          gap: 16px;
          max-width: 680px;
          margin: 0 auto 28px;
          padding: 0 24px;
        }

        .qk-fact {
          flex: 1;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .qk-fact-icon {
          margin-bottom: 12px;
          flex-shrink: 0;
        }

        .qk-fact-title {
          font-size: 14px;
          color: var(--white);
          font-weight: 500;
          margin-bottom: 4px;
        }

        .qk-fact-desc {
          font-size: 12px;
          color: var(--hint);
          line-height: 1.5;
        }

        /* ── Divider ── */
        .qk-divider {
          height: 1px;
          background: var(--border);
          max-width: 680px;
          margin: 0 auto 24px;
        }

        /* ── Quiz card ── */
        .qk-card {
          background: var(--card);
          border: 1px solid rgba(201,168,76,0.2);
          border-radius: var(--radius-card);
          padding: 28px 28px 20px;
          margin-bottom: 8px;
          transition: border-color 0.18s;
        }

        .qk-card:hover { border-color: rgba(201,168,76,0.3); }

        .qk-card-eyebrow {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--gold);
          margin-bottom: 10px;
        }

        .qk-card-tagline {
          font-size: 13px;
          color: var(--gold);
          margin-top: 8px;
          margin-bottom: 20px;
        }

        .qk-title {
          font-family: 'Libre Baskerville', serif;
          font-size: 26px;
          font-weight: 700;
          color: #ffffff;
          line-height: 1.2;
          margin-bottom: 0;
          letter-spacing: -0.02em;
        }

        .qk-card-date {
          font-size: 12px;
          color: var(--hint);
          margin-top: 6px;
          margin-bottom: 20px;
        }

        /* ── Topp 3 ── */
        .qk-prev-label {
          font-size: 11px;
          color: var(--hint);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          text-align: center;
          margin-bottom: 4px;
        }

        .qk-top3-rows {
          max-width: 360px;
          margin: 0 auto 20px;
        }

        .qk-top3-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: rgba(255,255,255,0.02);
          border-radius: 8px;
          margin-bottom: 6px;
        }

        .qk-top3-row:last-child { margin-bottom: 0; }

        .qk-top3-left {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--body);
          min-width: 0;
        }

        .qk-top3-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .qk-top3-right {
          font-size: 12px;
          color: var(--hint);
          white-space: nowrap;
          flex-shrink: 0;
          margin-left: 8px;
        }

        .qk-top3-time { margin-left: 4px; }

        /* ── Card actions ── */
        .qk-card-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }

        .qk-card-toplist {
          font-size: 12px;
          color: var(--body);
          text-decoration: none;
          transition: color 0.15s;
        }
        .qk-card-toplist:hover { color: var(--white); }

        .qk-btn-outline-gold {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 1px solid var(--gold);
          color: var(--gold);
          font-family: 'Instrument Sans', sans-serif;
          font-size: 15px;
          font-weight: 600;
          padding: 10px 28px;
          border-radius: var(--radius-btn);
          text-decoration: none;
          white-space: nowrap;
          transition: background 0.15s;
        }

        .qk-btn-outline-gold:hover { background: rgba(201,168,76,0.06); }

        /* ── Empty state ── */
        .qk-empty {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-card);
          padding: 48px 32px;
          text-align: center;
          margin-bottom: 12px;
        }

        .qk-empty-title {
          font-family: 'Libre Baskerville', serif;
          font-size: 18px;
          color: var(--white);
          margin-bottom: 8px;
        }

        .qk-empty-sub { font-size: 13px; color: var(--hint); line-height: 1.6; }

        /* ── Accordion wrapper ── */
        .qk-acc-wrap {
          margin-top: 36px;
          margin-bottom: 36px;
        }

        /* ── Bedrift ── */
        .qk-biz {
          max-width: 680px;
          margin: 0 auto 48px;
          padding: 0 24px;
        }

        .qk-biz-inner {
          background: #1e1a0e;
          border: 1px solid rgba(201,168,76,0.35);
          border-radius: var(--radius-card);
          padding: 28px;
          text-align: center;
        }

        .qk-biz-title {
          font-family: 'Libre Baskerville', serif;
          font-size: 20px;
          font-weight: 700;
          color: var(--white);
          margin-bottom: 8px;
        }

        .qk-biz-desc {
          font-size: 14px;
          color: var(--body);
          opacity: 0.85;
          margin-bottom: 16px;
          line-height: 1.6;
        }

        .qk-biz-link {
          font-size: 14px;
          color: var(--gold);
          text-decoration: none;
          transition: opacity 0.15s;
        }

        .qk-biz-link:hover { opacity: 0.8; }

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
          font-weight: 400;
          letter-spacing: 0.08em;
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

        /* ── Responsive ── */
        @media (max-width: 600px) {
          .qk-hero { padding: 36px 0 28px; }
          .qk-hero-title { font-size: 32px; }
          .qk-nav-play { display: none; }

          .qk-facts {
            flex-direction: column;
            gap: 24px;
          }

          .qk-fact {
            flex-direction: row;
            align-items: flex-start;
            text-align: left;
            gap: 14px;
          }

          .qk-fact-icon { margin-bottom: 0; }

          .qk-top3-time { display: none; }
        }
      `}</style>

      <PendingActionRedirect />

      <nav className="qk-nav">
        <div className="qk-nav-inner">
          <a href="/" className="qk-nav-logo">Quiz<em>kanonen</em></a>
          <div className="qk-nav-actions">
            <NavAuth quizId={quizList[0]?.id} />
          </div>
        </div>
      </nav>

      <div className="qk-page">

        {/* ── Hero ── */}
        <section className="qk-hero">
          <h1 className="qk-hero-title">
            Fredagsquizen der du <em>følger med over tid.</em>
          </h1>
          <p className="qk-hero-subtitle">
            Møt de samme folkene hver fredag. Klatre på topplisten.
          </p>
          <div className="qk-hero-actions">
            {quizList.length > 0 && (
              <Link href={`/quiz/${quizList[0].id}`} className="qk-btn-primary">
                Spill ukens quiz
              </Link>
            )}
          </div>
          <div className="qk-hero-status">
            <span><span style={{ color: '#c9a84c' }}>✓</span> <span style={{ color: '#e8e4dd' }}>Gratis</span></span>
            <span style={{ color: '#7a7873' }}>·</span>
            <span><span style={{ color: '#c9a84c' }}>✓</span> <span style={{ color: '#e8e4dd' }}>Innlogget</span></span>
            <span style={{ color: '#7a7873' }}>·</span>
            <span><span style={{ color: '#c9a84c' }}>★</span> <span style={{ color: '#e8e4dd' }}>Premium kr 49/mnd</span></span>
          </div>
        </section>

        {/* ── Sitat ── */}
        <p className="qk-quote">Ekte mennesker. Ekte navn. Hver fredag.</p>

        {/* ── Fakta-ikoner ── */}
        <div className="qk-facts">
          <div className="qk-fact">
            <div className="qk-fact-icon">
              <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="24" height="22" rx="3"/>
                <line x1="3" y1="11" x2="27" y2="11"/>
                <line x1="9" y1="3" x2="9" y2="8"/>
                <line x1="21" y1="3" x2="21" y2="8"/>
                <circle cx="10" cy="18" r="1.5" fill="#c9a84c" stroke="none"/>
                <circle cx="20" cy="18" r="1.5" fill="#c9a84c" stroke="none"/>
              </svg>
            </div>
            <div className="qk-fact-body">
              <div className="qk-fact-title">Hver fredag</div>
              <div className="qk-fact-desc">Ny quiz kl. 12. Fast tid, faste folk.</div>
            </div>
          </div>

          <div className="qk-fact">
            <div className="qk-fact-icon">
              <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="15" cy="10" r="5"/>
                <path d="M5 27c0-5.523 4.477-10 10-10s10 4.477 10 10"/>
              </svg>
            </div>
            <div className="qk-fact-body">
              <div className="qk-fact-title">Logg inn én gang</div>
              <div className="qk-fact-desc">Vi husker deg. Du vet hvem du spiller mot.</div>
            </div>
          </div>

          <div className="qk-fact">
            <div className="qk-fact-icon">
              <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 4l2.76 8.5H26l-7.1 5.16 2.72 8.34L15 21l-6.62 5 2.72-8.34L4 12.5h8.24L15 4z"/>
              </svg>
            </div>
            <div className="qk-fact-body">
              <div className="qk-fact-title">Følg sesongen</div>
              <div className="qk-fact-desc">Poeng akkumuleres uke for uke. Se hvem som leder.</div>
            </div>
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="qk-divider" />

        {/* ── Quiz-kort ── */}
        {quizList.length === 0 ? (
          <div className="qk-empty">
            <p className="qk-empty-title">Ingen aktive quizer akkurat nå</p>
            <p className="qk-empty-sub">
              Ny quiz legges ut hver fredag.<br />
              Følg med i Facebook-gruppen for varsling.
            </p>
            {nextQuizAt && (
              <p className="qk-card-date" style={{ marginBottom: 0 }}>
                Neste quiz: {formatNextQuiz(nextQuizAt)}
              </p>
            )}
          </div>
        ) : (() => {
          const quiz = quizList[0]
          const participantCount = quiz.attempts[0]?.count ?? 0
          const quizNotYetOpen = quiz.opens_at != null && new Date(quiz.opens_at) > now
          return (
            <div className="qk-card">
              <p className="qk-card-eyebrow">Denne uken</p>
              <h2 className="qk-title">{quiz.title}</h2>
              <p className="qk-card-tagline">
                {participantCount > 0 ? `${participantCount} deltakere · Kan du slå dem?` : 'Kan du slå dem?'}
              </p>
              {quizNotYetOpen && nextQuizAt && (
                <p className="qk-card-date">Neste quiz: {formatNextQuiz(nextQuizAt)}</p>
              )}

              {showTop3 && (
                <>
                  <p className="qk-prev-label">Forrige uke</p>
                  <div className="qk-top3-rows">
                    {top3.map((entry, i) => (
                      <div key={i} className="qk-top3-row">
                        <div className="qk-top3-left">
                          <span style={{ fontSize: 15 }}>{medals[i]}</span>
                          <span className="qk-top3-name">{truncateName(entry.player_name)}</span>
                        </div>
                        <div className="qk-top3-right">
                          {entry.correct_answers}/{entry.total_questions}
                          <span className="qk-top3-time"> · {formatTimeSec(entry.total_time_ms)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="qk-card-actions">
                <Link href={`/quiz/${quiz.id}`} className="qk-btn-outline-gold">
                  Spill nå
                </Link>
                <Link href={`/leaderboard/${quiz.id}`} className="qk-card-toplist">
                  Toppliste ↗
                </Link>
              </div>
            </div>
          )
        })()}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12, marginBottom: 32 }}>
          <Link href="/toppliste" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
            Se sesong-topplisten →
          </Link>
          <Link href="/quizer" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
            Se alle quizer →
          </Link>
        </div>

        {/* ── Accordion ── */}
        <div className="qk-acc-wrap">
          <AccordionSection />
        </div>

        {/* ── Bedrift ── */}
        <div className="qk-biz">
          <div className="qk-biz-inner">
            <h2 className="qk-biz-title">Bruker dere Quizkanonen på jobben?</h2>
            <p className="qk-biz-desc">Ukentlig fredagsquiz til teamet. Vi lager quizen. Dere spiller.</p>
            <Link href="/bedrift" className="qk-biz-link">Se løsninger for bedrifter →</Link>
          </div>
        </div>

        {/* ── Founders ── */}
        {FOUNDERS_ACTIVE && (
          <div className="qk-founders">
            <p className="qk-founders-eyebrow">Founders Access</p>
            <h2 className="qk-founders-title">Prøv Premium gratis i én måned</h2>
            <p className="qk-founders-sub">Ingen kortinfo. Ingen automatisk trekk. Vi minner deg på e-post før perioden utløper.</p>
            <Link href="/founders" className="qk-founders-btn">Aktiver gratis tilgang →</Link>
          </div>
        )}

      </div>
    </>
  )
}
