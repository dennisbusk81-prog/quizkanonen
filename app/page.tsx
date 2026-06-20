import { createSupabaseServer } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import PendingActionRedirect from '@/components/PendingActionRedirect'
import NavAuth from '@/components/NavAuth'
import OrgCard from '@/components/OrgCard'
import LeagueCard, { type LeagueCardData } from '@/components/LeagueCard'
import RivalryCard from '@/components/RivalryCard'
import ErrorBoundary from '@/components/ErrorBoundary'
import WelcomeBanner from '@/components/WelcomeBanner'
import GlobalLeagueChoiceBanner from '@/components/GlobalLeagueChoiceBanner'
import AccordionSection from '@/components/AccordionSection'
import NotifyForm from '@/components/NotifyForm'
import PushNotificationPrompt from '@/components/PushNotificationPrompt'
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

type MonthEntry = {
  displayName: string
  totalPoints: number
}

function formatNextQuiz(iso: string) {
  const d = new Date(iso)
  const weekday = d.toLocaleDateString('nb-NO', { weekday: 'long', timeZone: 'Europe/Oslo' })
  const day = d.toLocaleDateString('nb-NO', { day: 'numeric', timeZone: 'Europe/Oslo' }).replace(/\.$/, '')
  const month = d.toLocaleDateString('nb-NO', { month: 'long', timeZone: 'Europe/Oslo' })
  const time = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo', hour12: false })
  return `${weekday} ${day}. ${month} kl. ${time}`
}

function truncateName(name: string, max = 20): string {
  if (name.length <= max) return name
  return name.slice(0, max) + '…'
}

// Antall deltakere — samme tellelogikk som /toppliste (api/toppliste, last_quiz-modus):
// distinkte innloggede spillere (is_team=false, user_id ikke null), minus ekskluderte.
async function countParticipants(quizId: string): Promise<number> {
  const [{ data: attemptRows }, { data: excludedRows }] = await Promise.all([
    supabaseAdmin
      .from('attempts')
      .select('user_id')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .not('user_id', 'is', null),
    supabaseAdmin
      .from('excluded_members')
      .select('user_id')
      .eq('scope_type', 'global')
      .is('scope_id', null),
  ])
  const excludedSet = new Set(((excludedRows ?? []) as { user_id: string }[]).map(e => e.user_id))
  const players = new Set<string>()
  for (const r of (attemptRows ?? []) as { user_id: string }[]) {
    if (!excludedSet.has(r.user_id)) players.add(r.user_id)
  }
  return players.size
}

const SHARED_CSS = `
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
    --muted:    #7a7873;
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
    max-width: 900px;
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
    border: 0.5px solid #2a2d38;
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
    gap: 12px;
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
    color: #e8e4dd;
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
    color: #e8e4dd;
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
    display: inline-block;
    background: transparent;
    background-color: transparent;
    border: 1px solid #c9a84c;
    color: #c9a84c;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 10px 28px;
    border-radius: 10px;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }

  .qk-btn-outline-gold:hover {
    background: rgba(201,168,76,0.06);
    background-color: rgba(201,168,76,0.06);
  }

  .qk-btn-outline-dark {
    display: inline-block;
    background: transparent;
    border: 1px solid #2a2d38;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 10px 28px;
    border-radius: 10px;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .qk-btn-outline-dark:hover {
    border-color: #c9a84c;
  }

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

  .qk-empty-sub { font-size: 13px; color: #e8e4dd; line-height: 1.6; }

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
    padding: 10px 28px;
    border: 1px solid #e8e4dd;
    border-radius: 10px;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;
    transition: background 0.15s;
  }

  .qk-founders-btn:hover { background: rgba(232,228,221,0.06); }

  /* ── Personalized dashboard sections ── */
  .qkp-plain-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 28px;
    margin-top: 10px;
  }

  .qkp-section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--hint);
    margin-bottom: 14px;
  }

  .qkp-shortcuts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 10px;
  }

  .qkp-shortcut {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 20px;
    text-align: center;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transition: border-color 0.15s;
  }

  .qkp-shortcut:hover { border-color: rgba(201,168,76,0.3); }

  .qkp-shortcut-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--body);
  }

  .qkp-shortcut-arrow { font-size: 12px; color: var(--hint); }

  .qkp-lock-badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--gold);
    background: rgba(201,168,76,0.1);
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .qkp-league-top3 { max-width: none; margin-bottom: 16px; }

  /* ── Responsive ── */
  @media (max-width: 600px) {
    .qk-hero { padding: 36px 0 28px; }
    .qk-hero-title { font-size: 32px; }
    .qk-nav-play { display: none; }

    .qk-hero-actions {
      flex-direction: column;
      align-items: stretch;
      max-width: 280px;
      margin-left: auto;
      margin-right: auto;
    }

    .qk-btn-primary,
    .qk-btn-outline-dark {
      text-align: center;
      width: 100%;
    }

    .qk-facts { flex-direction: column; gap: 24px; }

    .qk-fact {
      flex-direction: row;
      align-items: flex-start;
      text-align: left;
      gap: 14px;
    }

    .qk-fact-icon { margin-bottom: 0; }
    .qk-top3-time { display: none; }
  }

  @media (max-width: 540px) {
    .qkp-shortcuts { grid-template-columns: 1fr 1fr; }
    .qkp-shortcut:last-child { grid-column: 1 / -1; }
  }

  /* ── How it works steps ── */
  .qk-steps {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    max-width: 480px;
    margin: 28px auto 0;
    position: relative;
  }

  .qk-steps::before {
    content: '';
    position: absolute;
    top: 18px;
    left: calc(16.7% + 18px);
    right: calc(16.7% + 18px);
    height: 1px;
    background: var(--border);
    pointer-events: none;
    z-index: 0;
  }

  .qk-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 0 8px;
  }

  .qk-step-num {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(201,168,76,0.1);
    border: 1px solid rgba(201,168,76,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Libre Baskerville', serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--gold);
    margin-bottom: 10px;
    position: relative;
    z-index: 1;
    flex-shrink: 0;
  }

  .qk-step-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--white);
    margin-bottom: 4px;
    line-height: 1.3;
  }

  .qk-step-desc {
    font-size: 12px;
    color: #e8e4dd;
    line-height: 1.5;
  }

  @media (max-width: 600px) {
    .qk-steps { grid-template-columns: 1fr; max-width: 240px; }
    .qk-steps::before { display: none; }
  }

  /* ── Interlude teaser ── */
  .qk-interlude {
    max-width: 680px;
    margin: 0 auto 28px;
    padding: 0 24px;
  }

  .qk-interlude-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #7a7873;
    margin-bottom: 12px;
    text-align: center;
  }

  .qk-interlude-cards {
    display: flex;
    gap: 12px;
  }

  .qk-interlude-card {
    flex: 1;
    background: #21242e;
    border: 1px solid rgba(201,168,76,0.15);
    border-radius: 16px;
    padding: 20px;
  }

  .qk-interlude-card-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 8px;
    line-height: 1.3;
  }

  .qk-interlude-card-text {
    font-size: 13px;
    color: #e8e4dd;
    line-height: 1.55;
    margin: 0;
  }

  @media (max-width: 600px) {
    .qk-interlude-cards { flex-direction: column; }
  }

  /* ── Desktop ── */
  @media (min-width: 769px) {
    .qk-hero-title    { font-size: 52px; }
    .qk-hero-subtitle { font-size: 18px; }
    .qk-card          { padding: 32px; }
    .qk-biz-inner     { padding: 32px; }
  }
`

export default async function Home() {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

  // ── Session check via cookie-based Supabase SSR client ──
  const supabaseServer = await createSupabaseServer()
  const { data: { user } } = await supabaseServer.auth.getUser()

  // ══════════════════════════════════════════════════════════
  // PERSONALIZED VIEW — logged-in users
  // ══════════════════════════════════════════════════════════
  if (user) {
    type RawSeasonRow = { user_id: string; points: number; profiles: { display_name: string | null } | null }
    type LeagueMemberRow = { league_id: string; leagues: { id: string; name: string } | null }
    type LeagueScoreRow  = { user_id: string; points: number; profiles: { display_name: string | null } | null }

    const [quizResult, allSeasonResult, profileResult, leagueResult, playedLogResult, monthlyAttemptsResult, lastClosedQuizResult] = await Promise.all([
      // Aktiv quiz: opens_at <= now og ikke stengt ennå
      supabaseAdmin
        .from('quizzes')
        .select('id, title, allow_teams, requires_access_code, time_limit_seconds, opens_at, closes_at, questions(count), attempts(count)')
        .lte('opens_at', now.toISOString())
        .or(`closes_at.is.null,closes_at.gte.${now.toISOString()}`)
        .order('opens_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('season_scores')
        .select('user_id, points, profiles(display_name)')
        .eq('scope_type', 'global')
        .is('scope_id', null)
        .gte('closes_at', monthStart)
        .lt('closes_at', monthEnd),
      supabaseAdmin
        .from('profiles')
        .select('display_name, premium_status')
        .eq('id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('league_members')
        .select('league_id, leagues(id, name)')
        .eq('user_id', user.id)
        .limit(5),
      // For logged-in users, attempts table is the authoritative source (mirrors quiz/[id]/page.tsx logic)
      supabaseAdmin
        .from('attempts')
        .select('quiz_id')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false })
        .limit(10),
      // Has the user played any quiz this calendar month?
      supabaseAdmin
        .from('attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('completed_at', monthStart)
        .lt('completed_at', monthEnd),
      // Siste stengte quiz — fallback for "Se topplisten" når ingen aktiv quiz finnes
      supabaseAdmin
        .from('quizzes')
        .select('id')
        .lt('closes_at', now.toISOString())
        .not('closes_at', 'is', null)
        .order('closes_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // Profile
    const profile = profileResult.data
    const isPremium = profile?.premium_status === true
    const displayName = profile?.display_name ?? user.email?.split('@')[0] ?? 'der'
    const firstName = displayName.split(' ')[0]

    // Quiz — aktiv (opens_at <= now, ikke stengt)
    const quizList = (quizResult.data as QuizRow[] | null) ?? []
    const quiz = quizList[0] ?? null

    // Siste stengte quiz — brukes som "Se topplisten"-mål når ingen aktiv quiz finnes
    const lastClosedQuizId = (lastClosedQuizResult.data as { id: string } | null)?.id ?? null

    // Kommende quiz — hentes kun om ingen aktiv finnes
    let upcomingQuiz: QuizRow | null = null
    if (!quiz) {
      const { data: upcomingData } = await supabaseAdmin
        .from('quizzes')
        .select('id, title, allow_teams, requires_access_code, time_limit_seconds, opens_at, closes_at, questions(count), attempts(count)')
        .gt('opens_at', now.toISOString())
        .or(`closes_at.is.null,closes_at.gte.${now.toISOString()}`)
        .order('opens_at', { ascending: true })
        .limit(1)
      upcomingQuiz = ((upcomingData as QuizRow[] | null) ?? [])[0] ?? null
    }

    const participantCount = quiz ? await countParticipants(quiz.id) : 0

    // Has the user already played the active quiz?
    type PlayedRow = { quiz_id: string }
    const playedQuizIds = new Set(
      ((playedLogResult.data as PlayedRow[] | null) ?? []).map(r => r.quiz_id)
    )
    const alreadyPlayed = quiz ? playedQuizIds.has(quiz.id) : false

    // Season — aggregate and compute user rank
    const rawRows = (allSeasonResult.data as RawSeasonRow[] | null) ?? []
    const byUser = new Map<string, { displayName: string; totalPoints: number }>()
    for (const row of rawRows) {
      const name = row.profiles?.display_name ?? '—'
      const existing = byUser.get(row.user_id)
      if (existing) existing.totalPoints += row.points
      else byUser.set(row.user_id, { displayName: name, totalPoints: row.points })
    }
    const sortedUsers = Array.from(byUser.entries()).sort((a, b) => b[1].totalPoints - a[1].totalPoints)
    const userRankIdx  = sortedUsers.findIndex(([uid]) => uid === user.id)
    const userRank     = userRankIdx === -1 ? 0 : userRankIdx + 1
    const userPoints   = byUser.get(user.id)?.totalPoints ?? 0
    // Round up to nearest 5 for the free-user estimate
    const estimatedBest = userRank > 0 ? Math.max(5, Math.ceil(userRank / 5) * 5) : 0
    const monthlyTop3 = sortedUsers.slice(0, 3).map(([, v]) => v)

    const playedThisMonth = (monthlyAttemptsResult.count ?? 0) > 0

    const monthName = now.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })

    // Leagues — hent data for alle ligaer brukeren er med i, parallelt
    const leagueRows = (leagueResult.data as LeagueMemberRow[] | null) ?? []
    const allLeagues = leagueRows
      .map(r => r.leagues)
      .filter((l): l is { id: string; name: string } => l !== null)

    type AttemptFallback = { user_id: string; correct_answers: number; total_time_ms: number }

    const leagueDataArr: LeagueCardData[] = await Promise.all(
      allLeagues.map(async (league) => {
        // Sesongpoeng for denne ligaen denne måneden
        const { data: leagueScores } = await supabaseAdmin
          .from('season_scores')
          .select('user_id, points, profiles(display_name)')
          .eq('scope_type', 'league')
          .eq('scope_id', league.id)
          .gte('closes_at', monthStart)
          .lt('closes_at', monthEnd)

        const lByUser = new Map<string, { displayName: string; points: number }>()
        for (const row of (leagueScores as LeagueScoreRow[] | null) ?? []) {
          const name = row.profiles?.display_name
          if (!name) continue
          const existing = lByUser.get(row.user_id)
          if (existing) existing.points += row.points
          else lByUser.set(row.user_id, { displayName: name, points: row.points })
        }

        if (lByUser.size > 0) {
          const top3 = Array.from(lByUser.values())
            .sort((a, b) => b.points - a.points)
            .slice(0, 3)
            .map(e => ({ displayName: e.displayName, value: e.points }))
          return { id: league.id, name: league.name, top3, fromFallback: false }
        }

        // Fallback: quizen er åpen — les direkte fra attempts
        if (quiz?.id) {
          const { data: memberRows } = await supabaseAdmin
            .from('league_members')
            .select('user_id')
            .eq('league_id', league.id)

          const memberIds = ((memberRows ?? []) as { user_id: string }[]).map(m => m.user_id)

          if (memberIds.length > 0) {
            const { data: attemptRows } = await supabaseAdmin
              .from('attempts')
              .select('user_id, correct_answers, total_time_ms')
              .eq('quiz_id', quiz.id)
              .in('user_id', memberIds)
              .eq('is_team', false)
              .not('user_id', 'is', null)

            const bestByUser = new Map<string, AttemptFallback>()
            for (const a of (attemptRows ?? []) as AttemptFallback[]) {
              const existing = bestByUser.get(a.user_id)
              if (
                !existing ||
                a.correct_answers > existing.correct_answers ||
                (a.correct_answers === existing.correct_answers && a.total_time_ms < existing.total_time_ms)
              ) {
                bestByUser.set(a.user_id, a)
              }
            }

            if (bestByUser.size > 0) {
              const sortedFallback = [...bestByUser.values()]
                .sort((a, b) =>
                  b.correct_answers !== a.correct_answers
                    ? b.correct_answers - a.correct_answers
                    : a.total_time_ms - b.total_time_ms
                )
                .slice(0, 3)

              const topIds = sortedFallback.map(a => a.user_id)
              const { data: profileRows } = await supabaseAdmin
                .from('profiles')
                .select('id, display_name')
                .in('id', topIds)

              const profileMap = new Map(
                ((profileRows ?? []) as { id: string; display_name: string | null }[])
                  .map(p => [p.id, p.display_name])
              )

              const top3 = sortedFallback.map(a => ({
                displayName: profileMap.get(a.user_id) ?? 'Spiller',
                value: a.correct_answers,
              }))
              return { id: league.id, name: league.name, top3, fromFallback: true }
            }
          }
        }

        return { id: league.id, name: league.name, top3: [], fromFallback: false }
      })
    )

    const todayLabel = now.toLocaleDateString('nb-NO', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo',
    })

    // ── Quiz insights: most recent closed quiz, all players ──
    type PageInsights = { easiest: { questionText: string; correctPct: number }; hardest: { questionText: string; correctPct: number } }
    let pageInsights: PageInsights | null = null
    try {
      const { data: closedQuizRow } = await supabaseAdmin
        .from('quizzes')
        .select('id, attempts!inner(id, attempt_answers!inner(id))')
        .lt('closes_at', now.toISOString())
        .not('closes_at', 'is', null)
        .order('closes_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (closedQuizRow) {
        const cqId = (closedQuizRow as { id: string }).id
        const { data: attemptRows } = await supabaseAdmin
          .from('attempts')
          .select('id')
          .eq('quiz_id', cqId)
          .eq('is_team', false)
          .not('user_id', 'is', null)
          .limit(500)

        const attemptIds = ((attemptRows ?? []) as { id: string }[]).map(a => a.id)
        if (attemptIds.length >= 3) {
          const { data: answerRows } = await supabaseAdmin
            .from('attempt_answers')
            .select('question_id, is_correct')
            .in('attempt_id', attemptIds)

          if (answerRows && answerRows.length > 0) {
            const statsMap = new Map<string, { total: number; correct: number }>()
            for (const a of answerRows as { question_id: string; is_correct: boolean }[]) {
              const s = statsMap.get(a.question_id) ?? { total: 0, correct: 0 }
              s.total++
              if (a.is_correct) s.correct++
              statsMap.set(a.question_id, s)
            }
            const qualified = [...statsMap.entries()]
              .filter(([, s]) => s.total >= 3)
              .map(([qId, s]) => ({ questionId: qId, correctPct: Math.round((s.correct / s.total) * 100) }))
              .sort((a, b) => b.correctPct - a.correctPct)

            if (qualified.length >= 2) {
              const { data: questionRows } = await supabaseAdmin
                .from('questions')
                .select('id, question_text')
                .in('id', qualified.map(q => q.questionId))

              const textMap = new Map(
                ((questionRows ?? []) as { id: string; question_text: string }[]).map(q => [q.id, q.question_text])
              )
              const withText = qualified
                .map(q => ({ questionText: textMap.get(q.questionId) ?? '', correctPct: q.correctPct }))
                .filter(q => q.questionText)

              if (withText.length >= 2) {
                pageInsights = { easiest: withText[0], hardest: withText[withText.length - 1] }
              }
            }
          }
        }
      }
    } catch {
      // silent — insights are non-critical
    }

    return (
      <>
        <style>{SHARED_CSS}</style>
        <PendingActionRedirect />

        <nav className="qk-nav">
          <div className="qk-nav-inner">
            <a href="/" className="qk-nav-logo">Quiz<em>kanonen</em></a>
            <div className="qk-nav-actions">
              <NavAuth quizId={quiz?.id} />
            </div>
          </div>
        </nav>

        <div className="qk-page">

          {/* Global liga-valg — vises kun til org-medlemmer som ikke har besvart */}
          <ErrorBoundary>
            <GlobalLeagueChoiceBanner />
          </ErrorBoundary>

          {/* Welcome */}
          <section style={{ paddingTop: 40, paddingBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
              <h1 style={{
                fontFamily: "'Libre Baskerville', serif",
                fontSize: 28,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1.2,
              }}>
                Hei, {firstName}!
              </h1>
              {isPremium && (
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#c9a84c',
                  background: 'rgba(201,168,76,0.12)',
                  border: '1px solid rgba(201,168,76,0.28)',
                  borderRadius: 999,
                  padding: '3px 10px',
                }}>
                  Premium
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: '#7a7873' }}>{todayLabel}</p>
          </section>

          {/* Rivalry card — innkommende utfordring vises høyt opp */}
          <ErrorBoundary>
            <RivalryCard prioritySlot="top" />
          </ErrorBoundary>

          {/* Quiz card */}
          {quiz ? (
            <div className="qk-card">
              <p className="qk-card-eyebrow">Denne uken</p>
              <h2 className="qk-title">{quiz.title}</h2>
              <p className="qk-card-tagline">
                {participantCount > 0 ? `${participantCount} deltakere · Kan du slå dem?` : 'Kan du slå dem?'}
              </p>
              {monthlyTop3.length > 0 && (
                <div style={{ margin: '14px 0 2px' }}>
                  <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 10 }}>
                    Månedens toppliste
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {monthlyTop3.map((entry, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, color: '#7a7873', width: 16, flexShrink: 0, fontWeight: 600 }}>{i + 1}.</span>
                        <span style={{ fontSize: 13, color: '#e8e4dd', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {truncateName(entry.displayName)}
                        </span>
                        <span style={{ fontSize: 12, color: '#c9a84c', flexShrink: 0, fontWeight: 600 }}>{entry.totalPoints} p</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="qk-card-actions">
                {alreadyPlayed ? (
                  <>
                    <p style={{ fontSize: 14, color: '#e8e4dd' }}>Du har allerede spilt denne uken</p>
                    <Link href={`/leaderboard/${quiz.id}`} className="qk-btn-outline-gold">
                      Se topplisten →
                    </Link>
                  </>
                ) : (
                  <Link href={`/quiz/${quiz.id}`} className="qk-btn-primary">
                    Spill ukens quiz
                  </Link>
                )}
              </div>
            </div>
          ) : upcomingQuiz ? (
            <div className="qk-card">
              <p className="qk-card-eyebrow">Kommende quiz</p>
              <h2 className="qk-title">{upcomingQuiz.title}</h2>
              <p className="qk-card-date">
                Åpner {upcomingQuiz.opens_at ? formatNextQuiz(upcomingQuiz.opens_at) : 'snart'}
              </p>
              {lastClosedQuizId && (
                <div className="qk-card-actions">
                  <Link href={`/leaderboard/${lastClosedQuizId}`} className="qk-btn-primary">
                    Se topplisten
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="qk-empty">
              <p className="qk-empty-title">Ingen quiz planlagt akkurat nå</p>
              <p className="qk-empty-sub">Kom tilbake snart.</p>
              {lastClosedQuizId && (
                <div className="qk-card-actions" style={{ marginTop: 16 }}>
                  <Link href={`/leaderboard/${lastClosedQuizId}`} className="qk-btn-primary">
                    Se topplisten
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Se alle quizer */}
          <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 4 }}>
            <Link href="/quizer" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
              Se alle quizer →
            </Link>
          </div>

          {/* Ukens fakta — quiz insights (only when last quiz is closed) */}
          {pageInsights && (
            <div style={{ marginTop: 16, marginBottom: 4, textAlign: 'center' }}>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 10 }}>
                Ukens fakta
              </p>
              <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 6 }}>
                {pageInsights.easiest.correctPct}% svarte riktig på ukens letteste:{' '}
                <span style={{ fontStyle: 'italic' }}>{pageInsights.easiest.questionText}</span>
              </p>
              <p style={{ fontSize: 14, color: '#c94c4c', lineHeight: 1.6 }}>
                Kun {pageInsights.hardest.correctPct}% klarte:{' '}
                <span style={{ fontStyle: 'italic' }}>{pageInsights.hardest.questionText}</span>
              </p>
            </div>
          )}

          {/* Season placement card */}
          <div className="qkp-plain-card">
            <p className="qkp-section-label">Sesong — {monthName}</p>

            {isPremium && userPoints > 0 && (
              <p style={{ fontSize: 16, color: '#ffffff', lineHeight: 1.5 }}>
                Du er på{' '}
                <strong style={{ color: '#c9a84c' }}>{userRank}. plass</strong>
                {' '}denne måneden
                <span style={{ color: '#e8e4dd' }}> · {userPoints} poeng</span>
              </p>
            )}
            {isPremium && userPoints === 0 && (
              <p style={{ fontSize: 15, color: '#e8e4dd' }}>
                {playedThisMonth
                  ? 'Du har spilt denne måneden — poeng oppdateres når quizen stenger'
                  : 'Du har ikke spilt denne måneden ennå'}
              </p>
            )}
            {!isPremium && userPoints > 0 && (
              <p style={{ fontSize: 15, color: '#e8e4dd' }}>
                Du er blant de{' '}
                <strong style={{ color: '#ffffff' }}>{estimatedBest}</strong>
                {' '}beste denne måneden
              </p>
            )}
            {!isPremium && userPoints === 0 && (
              <p style={{ fontSize: 15, color: '#e8e4dd' }}>
                {playedThisMonth
                  ? 'Du har spilt denne måneden — poeng oppdateres når quizen stenger'
                  : 'Du har ikke spilt denne måneden ennå'}
              </p>
            )}

            <div style={{
              marginTop: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}>
              <Link href="/toppliste" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                Se nøyaktig plassering →
              </Link>
              {!isPremium && (
                <Link href="/premium" className="qk-btn-outline-gold" style={{ fontSize: 13, padding: '7px 18px' }}>
                  Oppgrader til Premium
                </Link>
              )}
            </div>
          </div>

          {/* Org card — bedriftsliga, kun for org-medlemmer */}
          <ErrorBoundary>
            <OrgCard />
          </ErrorBoundary>

          {/* Shortcut grid */}
          <div className="qkp-shortcuts">
            <Link href="/toppliste" className="qkp-shortcut">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="13" width="4" height="7" rx="1"/>
                <rect x="9" y="8" width="4" height="12" rx="1"/>
                <rect x="16" y="3" width="4" height="17" rx="1"/>
              </svg>
              <span className="qkp-shortcut-label">Sesongtoppliste</span>
              <span className="qkp-shortcut-arrow">→</span>
            </Link>

            <Link href="/liga" className="qkp-shortcut">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="6" r="3"/>
                <circle cx="4" cy="14" r="2.5"/>
                <circle cx="18" cy="14" r="2.5"/>
                <path d="M7.5 8.5C5.5 9.5 4 11.5 4 14"/>
                <path d="M14.5 8.5C16.5 9.5 18 11.5 18 14"/>
              </svg>
              <span className="qkp-shortcut-label">Mine ligaer</span>
              <span className="qkp-shortcut-arrow">→</span>
            </Link>

            <Link
              href={isPremium ? '/historikk' : '/premium'}
              className="qkp-shortcut"
              style={{ opacity: isPremium ? 1 : 0.7 }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={isPremium ? '#c9a84c' : '#7a7873'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="M11 7v4l3 2"/>
              </svg>
              <span className="qkp-shortcut-label" style={{ color: '#e8e4dd' }}>
                Historikk
              </span>
              {isPremium
                ? <span className="qkp-shortcut-arrow">→</span>
                : <span className="qkp-lock-badge">Premium</span>
              }
            </Link>
          </div>

          {/* League card — klient-komponent for at velger + localStorage skal fungere */}
          {leagueDataArr.length > 0 && (
            <LeagueCard leagues={leagueDataArr} />
          )}

          {/* Rivalry card — H2H Duell (gratis), alle tilstander unntatt incoming */}
          <ErrorBoundary>
            <RivalryCard prioritySlot="default" />
          </ErrorBoundary>

        </div>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════
  // DEFAULT VIEW — not logged in (original homepage, unchanged)
  // ══════════════════════════════════════════════════════════

  const [{ data: quizzes }, { data: nextQuizSetting }, { data: lastQuizRaw }, { data: upcomingQuizData }, foundersSettingsResult, { data: anonSeasonRaw }] = await Promise.all([
    // Aktiv quiz: opens_at <= now og ikke stengt ennå
    supabaseAdmin
      .from('quizzes')
      .select('id, title, allow_teams, requires_access_code, time_limit_seconds, opens_at, closes_at, questions(count), attempts(count)')
      .lte('opens_at', now.toISOString())
      .or(`closes_at.is.null,closes_at.gte.${now.toISOString()}`)
      .order('opens_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', 'next_quiz_at')
      .maybeSingle(),
    supabaseAdmin
      .from('quizzes')
      .select('id, title, questions(count)')
      .lt('closes_at', now.toISOString())
      .not('closes_at', 'is', null)
      .order('closes_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Kommende quiz: opens_at > now og ikke stengt, hentes parallelt
    supabaseAdmin
      .from('quizzes')
      .select('id, title, allow_teams, requires_access_code, time_limit_seconds, opens_at, closes_at, questions(count), attempts(count)')
      .gt('opens_at', now.toISOString())
      .or(`closes_at.is.null,closes_at.gte.${now.toISOString()}`)
      .order('opens_at', { ascending: true })
      .limit(1),
    (async () => {
      try {
        const { data: settingsRows } = await supabaseAdmin
          .from('site_settings')
          .select('key, value')
          .in('key', ['founders_max_slots'])
        const rows = (settingsRows ?? []) as { key: string; value: string }[]
        const maxSlots = parseInt(rows.find(r => r.key === 'founders_max_slots')?.value ?? '250')
        const { count } = await supabaseAdmin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .in('premium_source', ['founders', 'code'])
          .eq('premium_status', true)
        const used = count ?? 0
        return { remaining: Math.max(0, maxSlots - used), max: maxSlots }
      } catch {
        return null
      }
    })(),
    // Månedlig global topp 3 fra season_scores (anon-visning)
    supabaseAdmin
      .from('season_scores')
      .select('user_id, points, profiles(display_name)')
      .eq('scope_type', 'global')
      .is('scope_id', null)
      .gte('closes_at', monthStart)
      .lt('closes_at', monthEnd),
  ])

  const quizList = (quizzes as QuizRow[] | null) ?? []
  const activeQuiz = quizList[0] ?? null
  const upcomingQuiz = ((upcomingQuizData as QuizRow[] | null) ?? [])[0] ?? null
  const nextQuizAt: string | null = (nextQuizSetting as { value: string } | null)?.value ?? null
  const activeParticipantCount = activeQuiz ? await countParticipants(activeQuiz.id) : 0

  // Beregn månedlig global topp 3 fra season_scores for anon-visning
  type AnonSeasonRow = { user_id: string; points: number; profiles: { display_name: string | null } | null }
  const anonByUser = new Map<string, { displayName: string; totalPoints: number }>()
  for (const row of (anonSeasonRaw as AnonSeasonRow[] | null) ?? []) {
    const name = row.profiles?.display_name
    if (!name) continue
    const existing = anonByUser.get(row.user_id)
    if (existing) existing.totalPoints += row.points
    else anonByUser.set(row.user_id, { displayName: name, totalPoints: row.points })
  }
  const anonMonthlyTop3 = Array.from(anonByUser.values())
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, 3)

  // Last closed quiz top 3
  type LastQuizRow = { id: string; title: string; questions: { count: number }[] }
  type Top3AttemptRow = { player_name: string; correct_answers: number; total_time_ms: number; user_id: string | null; nickname?: string | null }
  const lastQuiz = lastQuizRaw as LastQuizRow | null
  let lastQuizTop3: Top3AttemptRow[] = []

  if (lastQuiz) {
    const { data: top3Raw } = await supabaseAdmin
      .from('attempts')
      .select('player_name, correct_answers, total_time_ms, user_id')
      .eq('quiz_id', lastQuiz.id)
      .eq('is_team', false)
      .order('correct_answers', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .limit(3)

    lastQuizTop3 = (top3Raw as Top3AttemptRow[] | null) ?? []

    // Replace player_name with profile display_name where available
    const userIds = lastQuizTop3.map(r => r.user_id).filter(Boolean) as string[]
    if (userIds.length > 0) {
      const { data: profilesRaw } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, nickname')
        .in('id', userIds)
      const profileMap = new Map(
        ((profilesRaw ?? []) as { id: string; display_name: string | null; nickname: string | null }[])
          .map(p => [p.id, { displayName: p.display_name, nickname: p.nickname ?? null }])
      )
      lastQuizTop3 = lastQuizTop3.map(r => {
        const prof = r.user_id ? profileMap.get(r.user_id) : null
        return {
          ...r,
          player_name: prof?.displayName ?? r.player_name,
          nickname: prof?.nickname ?? null,
        }
      })
    }
  }

  // Next Friday at 12:00 (Oslo time) — for fallback card
  const nextFridayLabel = (() => {
    const oslo = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }))
    const day = oslo.getDay()
    const hour = oslo.getHours()
    let daysUntil = (5 - day + 7) % 7
    if (daysUntil === 0 && hour >= 12) daysUntil = 7
    const friday = new Date(now)
    friday.setDate(now.getDate() + daysUntil)
    return friday.toLocaleDateString('nb-NO', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Oslo',
    }) + ' kl. 12:00'
  })()

  return (
    <>
      <style>{SHARED_CSS}</style>

      <PendingActionRedirect />

      <nav className="qk-nav">
        <div className="qk-nav-inner">
          <a href="/" className="qk-nav-logo">Quiz<em>kanonen</em></a>
          <div className="qk-nav-actions">
            <NavAuth quizId={activeQuiz?.id} />
          </div>
        </div>
      </nav>

      <WelcomeBanner />

      <div className="qk-page">

        {/* ── Hero ── */}
        <section className="qk-hero">
          <h1 className="qk-hero-title">
            Fredagsquizen som du <em>følger med over tid.</em>
          </h1>
          <p className="qk-hero-subtitle">
            Slå de samme menneskene hver fredag. Kan du klatre på topplisten?
          </p>
          <div className="qk-hero-actions">
            {activeQuiz && (
              <Link href={`/login?next=/quiz/${activeQuiz.id}`} className="qk-btn-primary">
                Spill ukens quiz
              </Link>
            )}
            <Link href="/slik-fungerer-det" className="qk-btn-outline-dark">
              Slik fungerer det →
            </Link>
          </div>
          <div className="qk-hero-status">
            <span><span style={{ color: '#c9a84c' }}>✓</span> <span style={{ color: '#e8e4dd' }}>Gratis innlogging med Google</span></span>
            <span style={{ color: '#7a7873' }}>·</span>
            <span><span style={{ color: '#c9a84c' }}>★</span> <span style={{ color: '#e8e4dd' }}>Premium kr 49/mnd</span></span>
          </div>
          <div className="qk-steps">
            {([
              { n: '1', title: 'Spill quizen', desc: 'Hver fredag kl. 12. Svar raskt — tid teller.' },
              { n: '2', title: 'Se plasseringen', desc: 'Se nøyaktig hvor du havner blant alle deltakerne.' },
              { n: '3', title: 'Følg sesongen', desc: 'Kom tilbake neste uke og klatr.' },
            ] as const).map(({ n, title, desc }) => (
              <div key={n} className="qk-step">
                <div className="qk-step-num">{n}</div>
                <p className="qk-step-title">{title}</p>
                <p className="qk-step-desc">{desc}</p>
                {n === '3' && (
                  <p style={{ fontSize: 13, color: '#e8e4dd', marginTop: 6, lineHeight: 1.5 }}>
                    Sesongen nullstilles hver måned — ny sjanse for alle.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        <p className="qk-quote">Her teller det å kunne svaret — ikke bare å klikke først.</p>

        {/* ── Interlude teaser ── */}
        <div className="qk-interlude">
          <p className="qk-interlude-eyebrow">Under quizen</p>
          <div className="qk-interlude-cards">
            {([
              {
                title: 'Se plasseringen din live',
                text: 'Mellom hvert spørsmål ser du nøyaktig hvor du ligger — ikke bare til slutt.',
              },
              {
                title: 'Jag en rival',
                text: 'Systemet finner noen på ditt nivå. Kan du slå dem?',
              },
              {
                title: 'Tilpassede meldinger',
                text: 'Streak, halvtid, innspurt — quizen reagerer på hvordan du spiller.',
              },
            ] as const).map(({ title, text }) => (
              <div key={title} className="qk-interlude-card">
                <p className="qk-interlude-card-title">{title}</p>
                <p className="qk-interlude-card-text">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Quiz-kort ── */}
        {activeQuiz ? (
          <div className="qk-card">
            <p className="qk-card-eyebrow">Denne uken</p>
            <h2 className="qk-title">{activeQuiz.title}</h2>
            <p className="qk-card-tagline">
              {activeParticipantCount > 0
                ? `${activeParticipantCount} deltakere · Kan du slå dem?`
                : 'Kan du slå dem?'}
            </p>
            {anonMonthlyTop3.length > 0 && (
              <div style={{ margin: '14px 0 2px' }}>
                <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 10 }}>
                  Månedens toppliste
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {anonMonthlyTop3.map((entry, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: '#7a7873', width: 16, flexShrink: 0, fontWeight: 600 }}>{i + 1}.</span>
                      <span style={{ fontSize: 13, color: '#e8e4dd', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {truncateName(entry.displayName)}
                      </span>
                      <span style={{ fontSize: 12, color: '#c9a84c', flexShrink: 0, fontWeight: 600 }}>{entry.totalPoints} p</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="qk-card-actions">
              <a href={`/quiz/${activeQuiz.id}`} className="qk-btn-outline-dark">
                Spill nå
              </a>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                <Link href={`/leaderboard/${activeQuiz.id}`} className="qk-card-toplist">
                  Ukens resultater ↗
                </Link>
                <Link href="/quizer" className="qk-card-toplist">
                  Alle quizer →
                </Link>
              </div>
            </div>
          </div>
        ) : upcomingQuiz ? (
          <div className="qk-card">
            <p className="qk-card-eyebrow">Kommende quiz</p>
            <h2 className="qk-title">{upcomingQuiz.title}</h2>
            <p className="qk-card-date">
              Åpner {upcomingQuiz.opens_at ? formatNextQuiz(upcomingQuiz.opens_at) : 'snart'}
            </p>
            <div className="qk-card-actions">
              <Link href="/login" className="qk-btn-outline-gold" style={{ background: 'transparent', backgroundColor: 'transparent' }}>
                Få påminnelse på e-post →
              </Link>
            </div>
          </div>
        ) : (
          <div className="qk-card">
            <p className="qk-card-eyebrow">Ingen quiz planlagt</p>
            <h2 className="qk-title">Fredagsquizen</h2>
            <p style={{ fontSize: 14, color: 'var(--hint)', marginBottom: 20, lineHeight: 1.5 }}>
              Ingen quiz planlagt akkurat nå — kom tilbake snart.
            </p>
            {lastQuiz && (
              <div className="qk-card-actions">
                <Link href={`/leaderboard/${lastQuiz.id}`} className="qk-btn-primary">
                  Se topplisten
                </Link>
              </div>
            )}
          </div>
        )}

        {/* E-postvarsling — kun for uinnloggede, kun uten aktiv quiz */}
        {!user && !activeQuiz && (
          <div style={{
            background: '#21242e',
            border: '1px solid #2a2d38',
            borderRadius: 16,
            padding: '24px 24px',
            marginBottom: 8,
            textAlign: 'center',
          }}>
            <p style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 16,
              fontWeight: 700,
              color: '#ffffff',
              marginBottom: 6,
            }}>
              Få beskjed når neste quiz er klar
            </p>
            <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 18, lineHeight: 1.6 }}>
              Vi sender deg en e-post når neste quiz åpner.
            </p>
            <NotifyForm />
          </div>
        )}

        {/* ── Forrige uke — topp 3 ── */}
        {lastQuizTop3.length > 0 && lastQuiz && (
          <div style={{
            background: '#21242e',
            border: '1px solid #2a2d38',
            borderRadius: 16,
            padding: '20px 24px',
            marginBottom: 8,
          }}>
            <p style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#7a7873',
              marginBottom: 14,
            }}>Forrige uke — hvem vant?</p>
            <div className="qk-top3-rows qkp-league-top3">
              {lastQuizTop3.map((row, i) => {
                const totalSec = Math.round(row.total_time_ms / 1000)
                const totalQ = lastQuiz.questions[0]?.count ?? '?'
                return (
                  <div key={i} className="qk-top3-row">
                    <div className="qk-top3-left">
                      <span style={{ fontSize: 13, color: '#7a7873', width: 18, flexShrink: 0, fontWeight: 600 }}>
                        {i + 1}.
                      </span>
                      {row.nickname?.trim() ? (
                        <span style={{ minWidth: 0 }}>
                          <span className="qk-top3-name" style={{ display: 'block' }}>{truncateName(row.nickname.trim())}</span>
                          <span style={{ display: 'block', fontSize: 12, color: '#7a7873', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {truncateName(row.player_name)}
                          </span>
                        </span>
                      ) : (
                        <span className="qk-top3-name">{truncateName(row.player_name)}</span>
                      )}
                    </div>
                    <div className="qk-top3-right">
                      {row.correct_answers}/{totalQ}
                      <span className="qk-top3-time"> · {totalSec}s</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <Link href={`/leaderboard/${lastQuiz.id}`} style={{
              fontSize: 13,
              color: '#e8e4dd',
              textDecoration: 'none',
            }}>
              Se full toppliste →
            </Link>
          </div>
        )}

        {/* ── Org-kort (kun for bedriftsmedlemmer) ── */}
        <OrgCard />

        {/* ── Bedrift ── */}
        <div className="qk-biz">
          <div className="qk-biz-inner">
            <h2 className="qk-biz-title">Bruker dere Quizkanonen på jobben?</h2>
            <p className="qk-biz-desc">Ukentlig fredagsquiz til teamet. Vi lager quizen. Dere spiller.</p>
            <Link href="/bedrift" className="qk-biz-link">Se løsninger for bedrifter →</Link>
          </div>
        </div>

        {/* ── Accordion — slik fungerer det ── */}
        <div className="qk-acc-wrap">
          <AccordionSection />
        </div>

        {/* ── Founders ── */}
        {FOUNDERS_ACTIVE && (
          <div className="qk-founders">
            <p className="qk-founders-eyebrow">Founders Access</p>
            <h2 className="qk-founders-title">Prøv Premium gratis i én måned</h2>
            <p className="qk-founders-sub">Ingen kortinfo. Ingen automatisk trekk. Vi minner deg på e-post før perioden utløper.</p>
            {foundersSettingsResult && (
              <p style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#c9a84c',
                marginBottom: 14,
              }}>
                {foundersSettingsResult.remaining} av {foundersSettingsResult.max} plasser igjen
              </p>
            )}
            <Link href="/founders" className="qk-founders-btn">Aktiver gratis tilgang →</Link>
          </div>
        )}

      </div>

      <PushNotificationPrompt />
    </>
  )
}
