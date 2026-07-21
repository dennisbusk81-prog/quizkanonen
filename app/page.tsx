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
import { unstable_cache } from 'next/cache'

const FOUNDERS_ACTIVE = true

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
  return `${weekday} ${day}. ${month} kl. ${time} (norsk tid)`
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

// ── Delt (ikke-personalisert) forsidedata ─────────────────────────────────────
// Identisk for alle besøkende (anonyme og innloggede). Cachet med unstable_cache
// (revalidate 60s) slik at gjentatte besøk ikke trigger nye DB-spørringer.
//
// LEKKASJE-GARANTI: Disse funksjonene tar INGEN bruker-input og leser ALDRI
// cookies/session. De spør kun offentlig, delt innhold via supabaseAdmin. Ingen
// personalisert verdi kan derfor havne i den cachede responsen. Personalisert
// data (profil, ligaer, spilt-status, org-medlemskap) hentes per-request i
// branch-koden under, utenfor cachen.

const QUIZ_CARD_COLS =
  'id, title, allow_teams, requires_access_code, time_limit_seconds, opens_at, closes_at, questions(count), attempts(count)'

type StandingRow = { userId: string; displayName: string; totalPoints: number }
type Top3Row = { player_name: string; correct_answers: number; total_time_ms: number; nickname: string | null }
type SharedHomeData = {
  activeQuiz: QuizRow | null
  upcomingQuiz: QuizRow | null
  lastClosedQuiz: { id: string; title: string; questionsCount: number } | null
  nextQuizAt: string | null
  founders: { remaining: number; max: number } | null
  monthlyStandings: StandingRow[]
  participantCount: number
  lastQuizTop3: Top3Row[]
}
type PageInsights = {
  easiest: { questionText: string; correctPct: number }
  hardest: { questionText: string; correctPct: number }
}

async function computeSharedHomeData(): Promise<SharedHomeData> {
  const now = new Date()
  const nowIso = now.toISOString()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

  type RawSeasonRow = { user_id: string; points: number; profiles: { display_name: string | null } | null }

  const [activeRes, upcomingRes, lastClosedRes, nextSettingRes, foundersRes, seasonRes] = await Promise.all([
    supabaseAdmin
      .from('quizzes')
      .select(QUIZ_CARD_COLS)
      .eq('is_test', false)
      .lte('opens_at', nowIso)
      .or(`closes_at.is.null,closes_at.gte.${nowIso}`)
      .order('opens_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('quizzes')
      .select(QUIZ_CARD_COLS)
      .eq('is_test', false)
      .gt('opens_at', nowIso)
      .or(`closes_at.is.null,closes_at.gte.${nowIso}`)
      .order('opens_at', { ascending: true })
      .limit(1),
    supabaseAdmin
      .from('quizzes')
      .select('id, title, questions(count)')
      .eq('is_test', false)
      .lt('closes_at', nowIso)
      .not('closes_at', 'is', null)
      .order('closes_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', 'next_quiz_at')
      .maybeSingle(),
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
    supabaseAdmin
      .from('season_scores')
      .select('user_id, points, profiles(display_name)')
      .eq('scope_type', 'global')
      .is('scope_id', null)
      .gte('closes_at', monthStart)
      .lt('closes_at', monthEnd),
  ])

  const activeQuiz = ((activeRes.data as QuizRow[] | null) ?? [])[0] ?? null
  const upcomingQuiz = ((upcomingRes.data as QuizRow[] | null) ?? [])[0] ?? null

  const lcq = lastClosedRes.data as { id: string; title: string; questions: { count: number }[] } | null
  const lastClosedQuiz = lcq
    ? { id: lcq.id, title: lcq.title, questionsCount: lcq.questions?.[0]?.count ?? 0 }
    : null

  const nextQuizAt = (nextSettingRes.data as { value: string } | null)?.value ?? null
  const founders = foundersRes

  // Aggreger månedlig global toppliste (offentlig). Behold rader med tomt/null
  // navn som '—' slik at innlogget rang er identisk med tidligere; anon-visning
  // filtrerer '—' bort før topp 3.
  const byUser = new Map<string, StandingRow>()
  for (const row of (seasonRes.data as RawSeasonRow[] | null) ?? []) {
    const name = row.profiles?.display_name ?? '—'
    const existing = byUser.get(row.user_id)
    if (existing) existing.totalPoints += row.points
    else byUser.set(row.user_id, { userId: row.user_id, displayName: name, totalPoints: row.points })
  }
  const monthlyStandings = [...byUser.values()].sort((a, b) => b.totalPoints - a.totalPoints)

  const participantCount = activeQuiz ? await countParticipants(activeQuiz.id) : 0

  // Topp 3 fra siste stengte quiz, med profilnavn/kallenavn der tilgjengelig.
  let lastQuizTop3: Top3Row[] = []
  if (lastClosedQuiz) {
    const { data: top3Raw } = await supabaseAdmin
      .from('attempts')
      .select('player_name, correct_answers, total_time_ms, user_id')
      .eq('quiz_id', lastClosedQuiz.id)
      .eq('is_team', false)
      .order('correct_answers', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .limit(3)

    type RawTop3 = { player_name: string; correct_answers: number; total_time_ms: number; user_id: string | null }
    const rows = (top3Raw as RawTop3[] | null) ?? []
    const userIds = rows.map(r => r.user_id).filter(Boolean) as string[]
    let profileMap = new Map<string, { displayName: string | null; nickname: string | null }>()
    if (userIds.length > 0) {
      const { data: profilesRaw } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, nickname')
        .in('id', userIds)
      profileMap = new Map(
        ((profilesRaw ?? []) as { id: string; display_name: string | null; nickname: string | null }[])
          .map(p => [p.id, { displayName: p.display_name, nickname: p.nickname ?? null }])
      )
    }
    lastQuizTop3 = rows.map(r => {
      const prof = r.user_id ? profileMap.get(r.user_id) : null
      return {
        player_name: prof?.displayName ?? r.player_name,
        correct_answers: r.correct_answers,
        total_time_ms: r.total_time_ms,
        nickname: prof?.nickname ?? null,
      }
    })
  }

  return { activeQuiz, upcomingQuiz, lastClosedQuiz, nextQuizAt, founders, monthlyStandings, participantCount, lastQuizTop3 }
}

// tags gjør cachen eksplisitt invaliderbar via revalidateTag (kalt fra
// cron/publish-quiz hvert minutt) i stedet for å stole alene på at
// revalidate-vinduet faktisk trigger en fullført bakgrunnsrevalidering på
// Vercel sin serverless-plattform — se cron/publish-quiz for begrunnelse.
const getSharedHomeData = unstable_cache(computeSharedHomeData, ['home-shared-data-v2'], { revalidate: 60, tags: ['home-shared-data'] })

async function computePageInsights(): Promise<PageInsights | null> {
  const now = new Date()
  try {
    const { data: closedQuizRow } = await supabaseAdmin
      .from('quizzes')
      .select('id, attempts!inner(id, attempt_answers!inner(id))')
      .eq('is_test', false)
      .lt('closes_at', now.toISOString())
      .not('closes_at', 'is', null)
      .order('closes_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!closedQuizRow) return null
    const cqId = (closedQuizRow as { id: string }).id
    const { data: attemptRows } = await supabaseAdmin
      .from('attempts')
      .select('id')
      .eq('quiz_id', cqId)
      .eq('is_team', false)
      .not('user_id', 'is', null)
      .limit(500)

    const attemptIds = ((attemptRows ?? []) as { id: string }[]).map(a => a.id)
    if (attemptIds.length < 3) return null

    const { data: answerRows } = await supabaseAdmin
      .from('attempt_answers')
      .select('question_id, is_correct')
      .in('attempt_id', attemptIds)

    if (!answerRows || answerRows.length === 0) return null
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

    if (qualified.length < 2) return null
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

    if (withText.length < 2) return null
    return { easiest: withText[0], hardest: withText[withText.length - 1] }
  } catch {
    return null
  }
}

const getPageInsights = unstable_cache(computePageInsights, ['home-page-insights-v1'], { revalidate: 60, tags: ['home-page-insights'] })

// ── Grunnleggerhistorie-tall ──────────────────────────────────────────────────
// Offentlige, ikke-personaliserte tillitstall til forsidens grunnleggerseksjon.
// Endrer seg sakte (ny fredagsquiz i uken) — revalidate 3600s (1t) er nok,
// ingen grunn til å belaste DB som quiz-dataene.
//
// Definisjoner:
// - quizzesCompleted: COUNT quizzes med is_test=false og closes_at i fortiden
// - activePlayers: DISTINCT user_id med minst ett individuelt forsøk
//   (is_team=false, user_id ikke null) siste 12 uker (ett kvartal — matcher
//   Kvartal-periodiseringen i sesong-topplisten, samme spiller-definisjon som
//   countParticipants() over, bare utvidet fra "denne quizen" til et glidende
//   12-ukers vindu i stedet for én enkelt kalendermåned)
//
// Bedriftsantall er bevisst UTELATT — kun én reell betalende kunde per 20. juli
// 2026 gjør et rått tall til svakt sosialt bevis. Legges til igjen når
// kundeantallet faktisk sier noe.
type FounderStoryStats = { quizzesCompleted: number; activePlayers: number }

async function computeFounderStoryStats(): Promise<FounderStoryStats> {
  const twelveWeeksAgo = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()

  const [{ count: quizzesCompleted }, { data: activeRows }] = await Promise.all([
    supabaseAdmin
      .from('quizzes')
      .select('id', { count: 'exact', head: true })
      .eq('is_test', false)
      .not('closes_at', 'is', null)
      .lt('closes_at', nowIso),
    supabaseAdmin
      .from('attempts')
      .select('user_id')
      .eq('is_team', false)
      .not('user_id', 'is', null)
      .gte('completed_at', twelveWeeksAgo),
  ])

  const activePlayers = new Set(((activeRows ?? []) as { user_id: string }[]).map(r => r.user_id)).size

  return {
    quizzesCompleted: quizzesCompleted ?? 0,
    activePlayers,
  }
}

const getFounderStoryStats = unstable_cache(computeFounderStoryStats, ['home-founder-story-stats-v1'], { revalidate: 3600, tags: ['home-founder-story-stats'] })

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
    max-width: 900px;
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

  /* ── Grunnleggerhistorie — sekundær kort-stil, IKKE gull (to-gule-regel) ── */
  .qk-founder-story {
    max-width: 680px;
    margin: 0 auto 36px;
    padding: 0 24px;
  }

  .qk-founder-story-inner {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 28px;
    text-align: center;
  }

  .qk-founder-story-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--hint);
    margin-bottom: 10px;
  }

  .qk-founder-story-title {
    font-family: 'Libre Baskerville', serif;
    font-size: clamp(18px, 4vw, 20px);
    font-weight: 700;
    color: var(--white);
    line-height: 1.35;
    margin-bottom: 12px;
  }

  .qk-founder-story-body {
    font-size: 14px;
    color: var(--body);
    line-height: 1.65;
    margin-bottom: 20px;
  }

  .qk-founder-story-stats {
    display: flex;
    justify-content: center;
    gap: 28px;
    flex-wrap: wrap;
    margin-bottom: 20px;
    padding-top: 18px;
    border-top: 0.5px solid var(--border);
  }

  .qk-founder-stat-num {
    font-family: 'Libre Baskerville', serif;
    font-size: 22px;
    font-weight: 700;
    color: var(--white);
  }

  .qk-founder-stat-label {
    font-size: 11px;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
  }

  .qk-founder-story-link {
    font-size: 13px;
    color: #e8e4dd;
    text-decoration: none;
    border-bottom: 1px solid rgba(232,228,221,0.3);
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

  .qkp-greeting { font-size: 28px; }

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

  /* ── Visuell forhåndsvisning — fiktivt eksempel, sekundær kortstil, IKKE gull
     (respekterer to-gule-regel: "Spill ukens quiz"/"Se topplisten" er allerede
     det ene gule elementet på denne skjermen) ── */
  .qk-preview {
    max-width: 680px;
    margin: 0 auto 28px;
    padding: 0 24px;
  }

  .qk-preview-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #7a7873;
    margin-bottom: 12px;
    text-align: center;
  }

  .qk-preview-cards {
    display: flex;
    gap: 12px;
  }

  .qk-preview-card {
    flex: 1;
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 16px;
    padding: 20px 16px;
    text-align: center;
  }

  .qk-preview-card-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #7a7873;
    margin-bottom: 12px;
  }

  .qk-preview-card-text {
    font-size: 12px;
    color: #e8e4dd;
    line-height: 1.5;
    margin-top: 10px;
  }

  @media (max-width: 600px) {
    .qk-preview-cards { flex-direction: column; }
  }

  /* ── Desktop ── */
  @media (min-width: 769px) {
    .qk-hero-title    { font-size: 52px; }
    .qk-hero-subtitle { font-size: 18px; }
    .qk-card          { padding: 36px; margin-bottom: 24px; }
    .qk-biz-inner     { padding: 32px; }
    .qkp-greeting     { font-size: 2.4rem; }
    .qkp-plain-card   { margin-top: 24px; }
    .qkp-shortcuts    { margin-top: 24px; }
  }
`

export default async function Home() {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

  // Grunnleggerhistorie-tall — delt, ikke-personalisert, brukes i begge
  // grenene under (innlogget/gjest). Cachet (1t), så ett kall her koster
  // ingenting ekstra selv om det havner over begge return-stiene.
  const founderStats = await getFounderStoryStats()

  // ── Session check via cookie-based Supabase SSR client ──
  // Middleware (middleware.ts) already called getUser() on this same request,
  // which validates + refreshes the token cookie. Reading getSession() here is a
  // local cookie read (no extra GoTrue round-trip) — the JWT is Supabase-signed,
  // so the user.id is trustworthy for personalizing content.
  const supabaseServer = await createSupabaseServer()
  const { data: { session } } = await supabaseServer.auth.getSession()
  const user = session?.user ?? null

  // ══════════════════════════════════════════════════════════
  // PERSONALIZED VIEW — logged-in users
  // ══════════════════════════════════════════════════════════
  if (user) {
    type LeagueMemberRow = { league_id: string; leagues: { id: string; name: string } | null }
    type LeagueScoreRow  = { user_id: string; points: number; profiles: { display_name: string | null } | null }

    // Delt, ikke-personalisert data (quiz-kort, månedlig global toppliste,
    // deltakerantall, siste quiz) hentes fra den cachede bundelen — identisk for
    // alle og trygt å dele. Personaliserte spørringer kjøres per-request under.
    const shared = await getSharedHomeData()

    const [profileResult, leagueResult, playedLogResult, monthlyAttemptsResult, orgMembershipResult] = await Promise.all([
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
        .select('quiz_id, submitted_at')
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
      // Org-medlemskap — for kontekstuell "Se topplisten" når quizen er stengt
      supabaseAdmin
        .from('organization_members')
        .select('organizations(slug)')
        .eq('user_id', user.id),
    ])

    // Profile
    const profile = profileResult.data
    const isPremium = profile?.premium_status === true
    const displayName = profile?.display_name ?? user.email?.split('@')[0] ?? 'der'
    const firstName = displayName.split(' ')[0]

    // Quiz — aktiv (fra delt cache)
    const quiz = shared.activeQuiz

    // Siste stengte quiz — "Se topplisten"-mål når ingen aktiv quiz finnes
    const lastClosedQuizId = shared.lastClosedQuiz?.id ?? null

    // Org-medlemskap — er brukeren med i nøyaktig én org, lenker "Se topplisten"
    // (når quizen er stengt) til bedriftens side i stedet for quiz-topplisten.
    // Flere orger eller ingen ⇒ behold dagens leaderboard-lenke.
    type OrgSlugRow = { organizations: { slug: string } | { slug: string }[] | null }
    const orgSlugs = ((orgMembershipResult.data as OrgSlugRow[] | null) ?? [])
      .map(r => Array.isArray(r.organizations) ? r.organizations[0]?.slug : r.organizations?.slug)
      .filter((sl): sl is string => !!sl)
    const singleOrgToplistHref = orgSlugs.length === 1 ? `/org/${orgSlugs[0]}` : null

    // Kommende quiz (fra delt cache) — vises kun når ingen aktiv finnes
    const upcomingQuiz: QuizRow | null = quiz ? null : shared.upcomingQuiz

    const participantCount = shared.participantCount

    // Has the user already played the active quiz?
    type PlayedRow = { quiz_id: string; submitted_at: string | null }
    const attemptRows = (playedLogResult.data as PlayedRow[] | null) ?? []
    const myActiveAttempt = quiz ? attemptRows.find(r => r.quiz_id === quiz.id) : null
    const alreadyPlayed = myActiveAttempt?.submitted_at != null
    const hasUnfinished = myActiveAttempt != null && myActiveAttempt.submitted_at == null

    // Season — fra delt cache (offentlig månedlig global toppliste). Brukerens
    // egen rang utledes lokalt fra den delte lista (userId er offentlig toppliste-
    // info — ingen privat data i cachen).
    const standings = shared.monthlyStandings
    const userRankIdx  = standings.findIndex(s => s.userId === user.id)
    const userRank     = userRankIdx === -1 ? 0 : userRankIdx + 1
    const userPoints   = standings.find(s => s.userId === user.id)?.totalPoints ?? 0
    // Round up to nearest 5 for the free-user estimate
    const estimatedBest = userRank > 0 ? Math.max(5, Math.ceil(userRank / 5) * 5) : 0
    const monthlyTop3: MonthEntry[] = standings.slice(0, 3).map(s => ({ displayName: s.displayName, totalPoints: s.totalPoints }))

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

    // ── Quiz insights (delt, cachet) ──
    const pageInsights = await getPageInsights()

    return (
      <>
        <style>{SHARED_CSS}</style>
        <PendingActionRedirect />

        <nav className="qk-nav">
          <div className="qk-nav-inner">
            <Link href="/" className="qk-nav-logo">Quiz<em>kanonen</em></Link>
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
              <h1 className="qkp-greeting" style={{
                fontFamily: "'Libre Baskerville', serif",
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
                ) : hasUnfinished ? (
                  <Link href={`/quiz/${quiz.id}`} className="qk-btn-primary">
                    Fortsett quizen →
                  </Link>
                ) : (
                  <>
                    <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 10 }}>Ukens quiz venter på deg.</p>
                    <Link href={`/quiz/${quiz.id}`} className="qk-btn-primary">
                      Spill ukens quiz
                    </Link>
                  </>
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
              {(lastClosedQuizId || singleOrgToplistHref) && (
                <div className="qk-card-actions">
                  <Link href={singleOrgToplistHref ?? `/leaderboard/${lastClosedQuizId}`} className="qk-btn-primary">
                    Se topplisten
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="qk-empty">
              <p className="qk-empty-title">Ingen quiz planlagt akkurat nå</p>
              <p className="qk-empty-sub">Kom tilbake snart.</p>
              {(lastClosedQuizId || singleOrgToplistHref) && (
                <div className="qk-card-actions" style={{ marginTop: 16 }}>
                  <Link href={singleOrgToplistHref ?? `/leaderboard/${lastClosedQuizId}`} className="qk-btn-primary">
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

          {/* Org card — bedriftsliga, kun for org-medlemmer */}
          <ErrorBoundary>
            <OrgCard />
          </ErrorBoundary>

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
                  : 'Du er ikke i gang denne måneden ennå — bli med på fredag!'}
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

          {/* Premium-fordeler — kun for ikke-Premium-brukere */}
          {!isPremium && (
            <div style={{
              background: '#21242e',
              border: '1px solid #2a2d38',
              borderRadius: 16,
              padding: '20px 24px',
              marginTop: 10,
            }}>
              <p style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#7a7873',
                marginBottom: 12,
              }}>
                Dette får du med Premium
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  'Nøyaktig plassering på leaderboard',
                  'Full sesong-toppliste — søk og bla gjennom alle spillere',
                  'Historikk og statistikk — beste plassering, streak og utvikling over tid',
                  'Private ligaer med venner',
                ] as const).map(f => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#e8e4dd', lineHeight: 1.5 }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginTop: 2, flexShrink: 0 }}>
                      <circle cx="7" cy="7" r="6.5" stroke="#c9a84c" strokeWidth="1"/>
                      <path d="M4.5 7L6.5 9L9.5 5.5" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/premium" style={{
                display: 'inline-block',
                fontSize: 13,
                fontWeight: 600,
                color: '#e8e4dd',
                border: '1px solid #2a2d38',
                borderRadius: 10,
                padding: '8px 20px',
                textDecoration: 'none',
                fontFamily: "'Instrument Sans', sans-serif",
              }}>
                Se Premium →
              </Link>
            </div>
          )}

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

  const shared = await getSharedHomeData()

  const activeQuiz   = shared.activeQuiz
  const upcomingQuiz = shared.upcomingQuiz
  const nextQuizAt: string | null = shared.nextQuizAt
  const activeParticipantCount = shared.participantCount
  const foundersSettingsResult = shared.founders

  // Månedlig global topp 3 (anon) — filtrer bort tomme/manglende navn (som før),
  // deretter slice topp 3.
  const anonMonthlyTop3: MonthEntry[] = shared.monthlyStandings
    .filter(s => s.displayName && s.displayName !== '—')
    .slice(0, 3)
    .map(s => ({ displayName: s.displayName, totalPoints: s.totalPoints }))

  // Siste stengte quiz + topp 3 (fra delt cache)
  const lastQuiz = shared.lastClosedQuiz
  const lastQuizQuestionCount = shared.lastClosedQuiz?.questionsCount ?? 0
  const lastQuizTop3 = shared.lastQuizTop3

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
          <Link href="/" className="qk-nav-logo">Quiz<em>kanonen</em></Link>
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
            Én ny quiz. De samme rivalene. <em>Hver fredag.</em>
          </h1>
          <p className="qk-hero-subtitle">
            Svar på 15 spørsmål, se hvor du ligger og klatre på topplisten gjennom sesongen.
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
            <span><span style={{ color: '#c9a84c' }}>✓</span> <span style={{ color: '#e8e4dd' }}>Logg inn med Google, e-post eller passord</span></span>
            <span style={{ color: '#7a7873' }}>·</span>
            <span><span style={{ color: '#c9a84c' }}>★</span> <span style={{ color: '#e8e4dd' }}>Premium kr 49/mnd</span></span>
          </div>
          <div className="qk-steps">
            {([
              { n: '1', title: 'Spill quizen', desc: 'Hver fredag kl. 12 (norsk tid). Svar raskt — tid teller.' },
              { n: '2', title: 'Se plasseringen', desc: 'Se score og svartid. Med Premium: nøyaktig plassering og full toppliste.' },
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
                text: 'Mellom hvert spørsmål ser du hvordan du ligger an.',
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

        {/* ── Visuell forhåndsvisning — fiktivt eksempel, kun for gjester ── */}
        <div className="qk-preview">
          <p className="qk-preview-eyebrow">Eksempel — slik ser sesongen ut</p>
          <div className="qk-preview-cards">
            <div className="qk-preview-card">
              <p className="qk-preview-card-label">Plassering</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#7a7873' }}>18.</span>
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M1 6H15M15 6L10 1M15 6L10 11" stroke="#e8e4dd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff' }}>11.</span>
              </div>
              <p className="qk-preview-card-text">Du klatret fra 18. til 11. plass</p>
            </div>

            <div className="qk-preview-card">
              <p className="qk-preview-card-label">Rival</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#2a2d38', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: '#e8e4dd',
                }}>M</div>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#ffffff' }}>Maria</span>
              </div>
              <p className="qk-preview-card-text">120 poeng foran deg denne sesongen</p>
            </div>

            <div className="qk-preview-card">
              <p className="qk-preview-card-label">Sesongutvikling</p>
              <svg width="100%" height="40" viewBox="0 0 160 40" style={{ display: 'block', margin: '0 auto' }} preserveAspectRatio="xMidYMid meet">
                <polyline points="4,32 42,26 80,20 118,12 156,4" fill="none" stroke="#e8e4dd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="156" cy="4" r="3" fill="#ffffff" />
              </svg>
              <p className="qk-preview-card-text">Poengene bygger seg opp uke for uke</p>
            </div>
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
                const timeStr = `${(row.total_time_ms / 1000).toFixed(1)}s`
                const totalQ = lastQuizQuestionCount || '?'
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
                      <span className="qk-top3-time"> · {timeStr}</span>
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

        {/* ── Grunnleggerhistorie ── */}
        <div className="qk-founder-story">
          <div className="qk-founder-story-inner">
            <p className="qk-founder-story-eyebrow">Laget av en quizmaster</p>
            <h2 className="qk-founder-story-title">Over 20 års erfaring — hvert spørsmål skrives og kvalitetssikres før det havner i quizen.</h2>
            <p className="qk-founder-story-body">
              Dennis har laget og ledet quiz i over 20 år, digitalt og live, i Norge og Spania. Quizkanonen er bygget slik han selv ville ønsket det.
            </p>
            <div className="qk-founder-story-stats">
              <div>
                <div className="qk-founder-stat-num">{founderStats.quizzesCompleted}+</div>
                <div className="qk-founder-stat-label">Quizer gjennomført</div>
              </div>
              <div>
                <div className="qk-founder-stat-num">{founderStats.activePlayers}+</div>
                <div className="qk-founder-stat-label">Aktive spillere</div>
              </div>
            </div>
            <Link href="/om" className="qk-founder-story-link">Les historien →</Link>
          </div>
        </div>

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
