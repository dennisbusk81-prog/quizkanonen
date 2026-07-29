'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SiteNav from '@/components/SiteNav'
import OrgLockedScreen from '@/components/OrgLockedScreen'
import LeaveOrgModal from '@/components/LeaveOrgModal'
import ScheduleRemovalModal from '@/components/ScheduleRemovalModal'
import ResultsTable from '@/components/ResultsTable'
import { isOrgLocked } from '@/lib/org-access'
import { formatRemovalDate } from '@/lib/scheduled-removal'
import { ORG_PLANS, PLAN_ORDER, getPlan, type OrgPlanId } from '@/lib/org-plan'
import { getAvatarInitial } from '@/lib/avatar-initial'
import { getSessionIdentity } from '@/lib/session-identity'
import type { Session } from '@supabase/supabase-js'

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1a1c23; font-family: 'Instrument Sans', sans-serif; color: #e8e4dd; min-height: 100vh; }

  .oa-page { max-width: 900px; margin: 0 auto; padding: 0 20px 80px; }

  /* ── Section label ── */
  .oa-sec { display: flex; align-items: center; gap: 10px; margin: 36px 0 14px; }
  .oa-sec-text { font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #7a7873; white-space: nowrap; }
  .oa-sec-line { flex: 1; height: 1px; background: #2a2d38; }

  /* ── Stat card ── */
  .oa-stat {
    background: #21242e; border: 1px solid #2a2d38; border-radius: 14px;
    padding: 20px; flex: 1; min-width: 0; cursor: default;
    transition: border-color 0.2s, box-shadow 0.2s;
    position: relative; overflow: hidden;
  }
  .oa-stat::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, #c9a84c, rgba(201,168,76,0));
    opacity: 0; transition: opacity 0.2s;
  }
  .oa-stat:hover { border-color: rgba(201,168,76,0.25); }
  .oa-stat:hover::before { opacity: 1; }

  /* ── Tabs ── */
  .oa-tab-row { display: flex; border-bottom: 1px solid #2a2d38; margin-bottom: 0; }
  .oa-tab-a { padding: 10px 16px; background: none; border: none; border-bottom: 2px solid #c9a84c; margin-bottom: -1px; font-size: 13px; font-weight: 600; color: #c9a84c; font-family: 'Instrument Sans', sans-serif; cursor: pointer; }
  .oa-tab-i { padding: 10px 16px; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; font-size: 13px; font-weight: 600; color: #e8e4dd; font-family: 'Instrument Sans', sans-serif; cursor: pointer; }

  /* ── Input ── */
  .oa-input {
    background: #1a1c23; border: 1px solid #2a2d38; border-radius: 8px;
    padding: 9px 12px; font-size: 13px; color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif; outline: none;
    transition: border-color 0.15s;
  }
  .oa-input::placeholder { color: #7a7873; }
  .oa-input:focus { border-color: #c9a84c; }

  /* ── Rank badge colours ── */
  .oa-rank-gold   { color: #c9a84c; }
  .oa-rank-silver { color: #7a7873; }
  .oa-rank-bronze { color: #c4825a; }

  /* ── Responsive ── */
  @media (max-width: 580px) {
    .oa-stats-strip { flex-wrap: wrap !important; }
    .oa-stat { min-width: calc(50% - 6px) !important; }
    .oa-winners-grid { grid-template-columns: 1fr !important; }
  }
`

// ── Types ─────────────────────────────────────────────────────────────────────

type QuizEntry = {
  userId: string
  displayName: string
  correctAnswers: number
  totalTimeMs: number
}

type Member = {
  id: string
  user_id: string
  role: string
  joined_at: string
  display_name: string
  nickname?: string | null
  /** Satt = fjernes automatisk av /api/cron/scheduled-removals på datoen. */
  scheduled_removal_at?: string | null
}

type Invite = {
  id: string
  token: string
  use_count: number
  is_active: boolean
  created_at: string
  expires_at: string | null
  max_uses: number | null
}

type AdminData = {
  org: {
    id: string
    name: string
    plan: string
    stripe_period_end: string | null
    subscription_status: string
    allow_global_league: boolean
    weekly_report_timing: string
    org_quiz_opens_at: string | null
    org_quiz_closes_at: string | null
  }
  members: Member[]
  invites: Invite[]
  currentUserId: string
  stats?: { memberCount: number; activeThisMonth: number }
}

type InsightQuestion = { questionText: string; correctPct: number }
type InsightsData    = { quizTitle: string; easiest: InsightQuestion; hardest: InsightQuestion[] }

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionLabel({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="oa-sec">
      <span className="oa-sec-text">{title}</span>
      <div className="oa-sec-line" />
      {right}
    </div>
  )
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'rgba(201,168,76,0.10)', border: '1.5px solid rgba(201,168,76,0.25)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.38), fontWeight: 700, color: '#c9a84c', flexShrink: 0,
    }}>
      {getAvatarInitial(name)}
    </div>
  )
}

function Tag({ label, color, title }: { label: string; color: 'gold' | 'green' | 'blue' | 'muted'; title?: string }) {
  const map = {
    gold:  { bg: 'rgba(201,168,76,0.12)',  border: 'rgba(201,168,76,0.28)',  text: '#c9a84c' },
    green: { bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.25)',  text: '#4ade80' },
    blue:  { bg: 'rgba(99,179,237,0.10)',  border: 'rgba(99,179,237,0.25)',  text: '#e8e4dd' },
    muted: { bg: 'rgba(122,120,115,0.12)', border: 'rgba(122,120,115,0.25)', text: '#7a7873' },
  }
  const c = map[color]
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      padding: '2px 7px', borderRadius: 999,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      textTransform: 'uppercase', flexShrink: 0,
    }}>
      {label}
    </span>
  )
}

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function getPrevPeriodRange(period: 'month' | 'quarter' | 'year'): { start: string; end: string } {
  const now = new Date()
  let start: Date, end: Date
  if (period === 'month') {
    end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  } else if (period === 'quarter') {
    const currentQ = Math.floor(now.getUTCMonth() / 3)
    end   = new Date(Date.UTC(now.getUTCFullYear(), currentQ * 3, 1))
    start = new Date(Date.UTC(now.getUTCFullYear(), (currentQ - 1) * 3, 1))
  } else {
    end   = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    start = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))
  }
  return { start: start.toISOString(), end: end.toISOString() }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrgAdminPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<AdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Skiller «du har ikke tilgang» fra «vi klarte ikke å hente dataene». Uten
  // dette fikk en treg/feilende respons overskriften «Ingen tilgang», som er
  // feil diagnose og sender admin til feil sted.
  const [errorKind, setErrorKind] = useState<'access' | 'load'>('access')
  // Settes når admin-data faktisk har landet (eller feilet) — slik at
  // 8-sekunders-vakten under vet om den skal si fra eller holde kjeft.
  const loadSettledRef = useRef(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  type WinnerEntry = { displayName: string; avatarUrl: string | null; points: number } | null
  const [winners, setWinners] = useState<{ month: WinnerEntry; quarter: WinnerEntry; year: WinnerEntry } | null>(null)

  const [creatingInvite, setCreatingInvite] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  type Top3Entry = { displayName: string; points: number }
  const [top3Winners, setTop3Winners] = useState<{ month: Top3Entry[]; quarter: Top3Entry[]; year: Top3Entry[] }>({ month: [], quarter: [], year: [] })
  const [copiedWinner, setCopiedWinner] = useState<false | 'month' | 'quarter' | 'year'>(false)
  const [shareHovered, setShareHovered] = useState<false | 'month' | 'quarter' | 'year'>(false)

  const [allowGlobal, setAllowGlobal] = useState(false)

  // Weekly report (Standard plan)
  type WeeklyEntry = { displayName: string; correct: number; total: number }
  type WeeklySummary = { quizTitle: string; closesAt: string; winner: WeeklyEntry | null; top3: WeeklyEntry[]; participantCount: number }
  const [weeklySummary, setWeeklySummary]   = useState<WeeklySummary | null>(null)
  const [weeklyShareText, setWeeklyShareText] = useState<string | null>(null)
  const [weeklyLoading, setWeeklyLoading]   = useState(false)
  const [weeklyCopied, setWeeklyCopied]     = useState(false)
  const [reportTiming, setReportTiming]     = useState('monday_morning')
  const [savingTiming, setSavingTiming]     = useState(false)
  const [timingSaved, setTimingSaved]       = useState(false)
  const [timingError, setTimingError]       = useState<string | null>(null)

  const [orgQuizOpensAt, setOrgQuizOpensAt]   = useState('')
  const [orgQuizClosesAt, setOrgQuizClosesAt] = useState('')
  const [savingQuizTimes, setSavingQuizTimes] = useState(false)
  const [quizTimesSaved, setQuizTimesSaved]   = useState(false)
  const [quizTimesError, setQuizTimesError]   = useState<string | null>(null)

  const [emailInviteOpen, setEmailInviteOpen]     = useState(false)
  const [emailInviteText, setEmailInviteText]     = useState('')
  const [emailInviteSending, setEmailInviteSending] = useState(false)
  const [emailInviteResult, setEmailInviteResult]   = useState<{ sent: number; failed: string[] } | null>(null)
  const [emailInviteError, setEmailInviteError]     = useState<string | null>(null)

  const [seasonResetModal, setSeasonResetModal]   = useState(false)
  const [seasonResetInput, setSeasonResetInput]   = useState('')
  const [seasonResetting, setSeasonResetting]     = useState(false)
  const [seasonResetDone, setSeasonResetDone]     = useState(false)
  const [seasonResetError, setSeasonResetError]   = useState<string | null>(null)

  const [deleteOrgModal, setDeleteOrgModal]       = useState(false)
  const [deleteOrgInput, setDeleteOrgInput]       = useState('')
  const [deletingOrg, setDeletingOrg]             = useState(false)
  const [deleteOrgError, setDeleteOrgError]       = useState<string | null>(null)

  const [leaveOrgModal, setLeaveOrgModal]         = useState(false)

  // Planlagt fjerning: hvilket medlem modalen gjelder, og feilmelding fra
  // «avbryt plan» (som kjøres uten modal — å avbryte er ufarlig og reversibelt).
  // Bedriftsnavn (redigerbart) og planbytte
  const [orgNameInput, setOrgNameInput]   = useState('')
  const [savingName, setSavingName]       = useState(false)
  const [nameSaved, setNameSaved]         = useState(false)
  const [nameError, setNameError]         = useState<string | null>(null)
  const [changingPlan, setChangingPlan]   = useState<OrgPlanId | null>(null)
  const [planChangeError, setPlanChangeError] = useState<string | null>(null)
  const [planChanged, setPlanChanged]     = useState<string | null>(null)

  const [scheduleTarget, setScheduleTarget]   = useState<Member | null>(null)
  const [cancellingPlanId, setCancellingPlanId] = useState<string | null>(null)
  const [planError, setPlanError]             = useState<string | null>(null)

  const [portalLoading, setPortalLoading]         = useState(false)
  const [portalError, setPortalError]             = useState<string | null>(null)

  const [hoveredMemberId, setHoveredMemberId]     = useState<string | null>(null)
  const [adminActionLoading, setAdminActionLoading] = useState(false)
  const [adminActionError, setAdminActionError]   = useState<string | null>(null)
  const [adminActionSuccess, setAdminActionSuccess] = useState<string | null>(null)

  // activeLast30Days styrer AKTIV-merket og er rullerende (levert quiz siste 30
  // dager). hasPeriodScore følger måned/kvartal/år-fanen og hører til
  // poeng-kolonnene — de to skal IKKE slås sammen igjen.
  type MemberActivity = { userId: string; displayName: string; role: string; activeLast30Days: boolean; hasPeriodScore: boolean; totalPoints: number; quizCount: number; lastActiveAt: string | null; isExcluded: boolean }
  const [activityPeriod, setActivityPeriod] = useState<'month' | 'quarter' | 'year'>('month')
  const [activityData, setActivityData]     = useState<MemberActivity[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [excludingId, setExcludingId]       = useState<string | null>(null)
  const [csvLoading, setCsvLoading]         = useState(false)
  const [csvError, setCsvError]             = useState<string | null>(null)

  // Toppliste top-level tab
  const [topTab, setTopTab]       = useState<'quiz' | 'season'>('quiz')
  const [quizData, setQuizData]   = useState<QuizEntry[] | null>(null)
  const [quizTitle, setQuizTitle] = useState<string | null>(null)
  const [quizLoading, setQuizLoading] = useState(false)
  // Skiller «ingen har spilt» fra «vi vet ikke hvem som har spilt». Uten dette
  // ble en feilet quiz-scores-henting til en tom liste, og påminnelsesknappen
  // ville regnet HELE bedriften som inaktiv og sendt e-post til alle.
  const [quizError, setQuizError] = useState(false)

  // Reminder
  const [reminderSending, setReminderSending] = useState(false)
  const [reminderMsg, setReminderMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  // Previous-period ranks for trend indicators (null = not yet loaded)
  const [prevRanks, setPrevRanks] = useState<Map<string, number> | null>(null)

  // Weekly play streak per member (userId → consecutive weeks)
  const [streaks, setStreaks] = useState<Map<string, number>>(new Map())

  // Quiz insights (easiest / hardest questions)
  const [insightsData, setInsightsData]       = useState<InsightsData | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  // Search
  const [memberSearch, setMemberSearch] = useState('')

  // Vakt mot en hengende admin-data-respons. Slo tidligere bare av loading
  // uansett, slik at siden rendret med data = null — admin fikk et tomt panel
  // (0 medlemmer, ingen invitasjonslenke) som var umulig å skille fra en
  // faktisk tom bedrift. Nå sier den fra i stedet.
  useEffect(() => {
    const t = setTimeout(() => {
      if (loadSettledRef.current) return
      setErrorKind('load')
      setError('Kunne ikke laste bedriftsdata, prøv igjen.')
      setLoading(false)
    }, 8000)
    return () => clearTimeout(t)
  }, [loadAttempt])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const loadWinners = useCallback((orgId: string, token: string) => {
    const periods = ['month', 'quarter', 'year'] as const
    Promise.all(
      periods.map(p =>
        fetch(`/api/toppliste?period=${p}&scope=organization&scope_id=${encodeURIComponent(orgId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
          .then(r => r.ok ? r.json() : { entries: [] })
          .catch(() => ({ entries: [] }))
      )
    ).then(([monthJson, quarterJson, yearJson]) => {
      type ApiEntry = { displayName: string; avatarUrl: string | null; points: number }
      const toWinner = (entries: ApiEntry[]) =>
        entries[0] ? { displayName: entries[0].displayName, avatarUrl: entries[0].avatarUrl ?? null, points: entries[0].points } : null
      const toTop3 = (entries: ApiEntry[]) =>
        entries.slice(0, 3).map(e => ({ displayName: e.displayName, points: e.points }))
      const mE = (monthJson.entries ?? []) as ApiEntry[]
      const qE = (quarterJson.entries ?? []) as ApiEntry[]
      const yE = (yearJson.entries ?? []) as ApiEntry[]
      setWinners({ month: toWinner(mE), quarter: toWinner(qE), year: toWinner(yE) })
      setTop3Winners({ month: toTop3(mE), quarter: toTop3(qE), year: toTop3(yE) })
    })
  }, [])

  const loadActivity = useCallback(async (orgId: string, token: string, period: 'month' | 'quarter' | 'year') => {
    setActivityLoading(true)
    setActivityData(null)
    try {
      const res = await fetch(`/api/org/${orgId}/members-activity?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = res.ok ? await res.json() : { members: [] }
      setActivityData(json.members ?? [])
    } catch {
      setActivityData([])
    } finally {
      setActivityLoading(false)
    }
  }, [])

  const loadQuizLeaderboard = useCallback(async (orgId: string, token: string) => {
    setQuizLoading(true)
    setQuizData(null)
    setQuizError(false)
    try {
      // attempts.user_id er ikke lenger lesbar med klient-nøkkelen — hentes
      // server-side (verifiserer org-admin) via /api/org/[slug]/quiz-scores.
      const res = await fetch(`/api/org/${orgId}/quiz-scores`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { setQuizError(true); setQuizData([]); return }
      const json = await res.json() as { quizTitle: string | null; entries: QuizEntry[] }
      if (json.quizTitle) setQuizTitle(json.quizTitle)
      setQuizData(json.entries ?? [])
    } catch {
      setQuizError(true)
      setQuizData([])
    } finally {
      setQuizLoading(false)
    }
  }, [])

  const loadPrevRanks = useCallback(async (orgId: string, members: Member[], period: 'month' | 'quarter' | 'year') => {
    setPrevRanks(null)
    try {
      const { start, end } = getPrevPeriodRange(period)
      const memberIds = members.map(m => m.user_id)
      const { data: prevScores } = await supabase
        .from('season_scores')
        .select('user_id, points, quiz_id')
        .eq('scope_type', 'organization')
        .eq('scope_id', orgId)
        .gte('closes_at', start)
        .lt('closes_at', end)
        .in('user_id', memberIds)

      if (!prevScores || prevScores.length === 0) { setPrevRanks(new Map()); return }

      // Aggregate points per user (dedup by quiz_id, same logic as the API)
      const pointsMap = new Map<string, { points: number; quizIds: Set<string> }>()
      for (const s of prevScores as { user_id: string; points: number; quiz_id: string }[]) {
        const existing = pointsMap.get(s.user_id) ?? { points: 0, quizIds: new Set<string>() }
        if (!existing.quizIds.has(s.quiz_id)) {
          existing.points += s.points
          existing.quizIds.add(s.quiz_id)
        }
        pointsMap.set(s.user_id, existing)
      }

      // Sort by points desc → assign ranks
      const sorted = [...pointsMap.entries()]
        .filter(([, v]) => v.points > 0)
        .sort(([, a], [, b]) => b.points - a.points)

      const ranks = new Map<string, number>()
      sorted.forEach(([userId], idx) => ranks.set(userId, idx + 1))
      setPrevRanks(ranks)
    } catch {
      setPrevRanks(new Map()) // silent — trend indicators are non-critical
    }
  }, [])

  const loadStreaks = useCallback(async (orgId: string, token: string) => {
    setStreaks(new Map())
    try {
      // Streaks beregnes server-side (krever attempts.user_id) via samme rute.
      const res = await fetch(`/api/org/${orgId}/quiz-scores`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const json = await res.json() as { streaks: Record<string, number> }
      if (json.streaks) setStreaks(new Map(Object.entries(json.streaks)))
    } catch {
      // silent — streak is non-critical
    }
  }, [])

  const loadInsights = useCallback(async (orgId: string, token: string) => {
    setInsightsLoading(true)
    setInsightsData(null)
    try {
      const res = await fetch(`/api/org/${orgId}/quiz-insights`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setInsightsData(await res.json())
    } catch {
      // silent — insights are non-critical
    } finally {
      setInsightsLoading(false)
    }
  }, [])

  const loadWeeklySummary = useCallback(async (token: string) => {
    setWeeklyLoading(true)
    try {
      const res = await fetch(`/api/org/${slug}/weekly-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setWeeklySummary(json.summary ?? null)
        setWeeklyShareText(json.shareText ?? null)
      }
    } catch {
      // silent — weekly summary is non-critical
    } finally {
      setWeeklyLoading(false)
    }
  }, [slug])

  const loadData = useCallback((sess: Session) => {
    fetch(`/api/org/${slug}/admin-data`, {
      headers: { Authorization: `Bearer ${sess.access_token}` },
    })
      .then(r => {
        if (r.status === 403) { setErrorKind('access'); setError('Ingen admin-tilgang.'); return null }
        if (!r.ok) { setErrorKind('load'); setError('Kunne ikke laste bedriftsdata, prøv igjen.'); return null }
        return r.json()
      })
      .then((d: AdminData | null) => {
        if (d) {
          setData(d)
          setAllowGlobal(d.org.allow_global_league)
          setOrgNameInput(d.org.name)
          setReportTiming(d.org.weekly_report_timing ?? 'monday_morning')
          setOrgQuizOpensAt(d.org.org_quiz_opens_at ?? '')
          setOrgQuizClosesAt(d.org.org_quiz_closes_at ?? '')
          if (d.org.plan === 'standard') loadWeeklySummary(sess.access_token)
          loadWinners(d.org.id, sess.access_token)
          loadActivity(d.org.id, sess.access_token, 'month')
          loadPrevRanks(d.org.id, d.members, 'month')
          loadStreaks(d.org.id, sess.access_token)
          loadInsights(d.org.id, sess.access_token)
          loadQuizLeaderboard(d.org.id, sess.access_token)
        }
      })
      .catch(() => { setErrorKind('load'); setError('Kunne ikke laste bedriftsdata, prøv igjen.') })
      .finally(() => { loadSettledRef.current = true; setLoading(false) })
  }, [slug, loadWinners, loadActivity, loadPrevRanks, loadStreaks, loadInsights, loadQuizLeaderboard, loadWeeklySummary])

  // «Prøv igjen» fra load-feilskjermen: rearmer 8-sekunders-vakten og henter på
  // nytt, i stedet for å tvinge admin til å laste hele siden om igjen.
  const retryLoad = useCallback(() => {
    if (!session) { router.push(`/login?next=/org/${slug}/admin`); return }
    loadSettledRef.current = false
    setError('')
    setLoading(true)
    setLoadAttempt(n => n + 1)
    loadData(session)
  }, [session, router, slug, loadData])

  // Stabil identitet — se lib/session-identity.ts. Unngår at loadData() (som
  // nuller activityData/quizData til null før refetch) kjører på nytt bare
  // fordi Supabase fyrer TOKEN_REFRESHED ved fane-fokus, uten at brukeren
  // faktisk har endret seg. session leses fortsatt friskt inne i effekten.
  const sessionIdentity = getSessionIdentity(session)
  useEffect(() => {
    if (session === undefined) return
    if (!session) { router.push(`/login?next=/org/${slug}/admin`); return }
    loadData(session)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdentity, slug, router, loadData])

  useEffect(() => {
    if (!data || !session) return
    loadActivity(data.org.id, session.access_token, activityPeriod)
    loadPrevRanks(data.org.id, data.members, activityPeriod)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityPeriod])

  const createInvite = async () => {
    if (!session || !data) return
    setCreatingInvite(true)
    setInviteError(null)
    try {
      const res = await fetch('/api/org/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ organization_id: data.org.id }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setInviteError(json?.error ?? 'Kunne ikke opprette invitasjonslenke. Prøv igjen.')
        return
      }
      loadData(session)
    } catch {
      setInviteError('Kunne ikke opprette invitasjonslenke. Prøv igjen.')
    } finally {
      setCreatingInvite(false)
    }
  }

  const deactivateInvite = async (id: string) => {
    if (!session) return
    setDeactivatingId(id)
    setInviteError(null)
    try {
      const res = await fetch(`/api/org/invites/${id}/deactivate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setInviteError(json?.error ?? 'Kunne ikke deaktivere invitasjonslenken. Prøv igjen.')
        return
      }
      loadData(session)
    } catch {
      setInviteError('Kunne ikke deaktivere invitasjonslenken. Prøv igjen.')
    } finally {
      setDeactivatingId(null)
    }
  }

  // Deactivate old invite and immediately create a new one.
  // To kall etter hverandre: hvis det andre feiler står bedriften uten aktiv
  // lenke, og da må admin få vite akkurat det — ikke bare se en knapp som
  // slutter å spinne.
  const renewInvite = async (id: string) => {
    if (!session || !data) return
    setDeactivatingId(id)
    setCreatingInvite(true)
    setInviteError(null)
    try {
      const deactivateRes = await fetch(`/api/org/invites/${id}/deactivate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!deactivateRes.ok) {
        const json = await deactivateRes.json().catch(() => null)
        setInviteError(json?.error ?? 'Kunne ikke fornye invitasjonslenken. Den gamle lenken gjelder fortsatt.')
        return
      }
      const createRes = await fetch('/api/org/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ organization_id: data.org.id }),
      })
      if (!createRes.ok) {
        const json = await createRes.json().catch(() => null)
        setInviteError(json?.error ?? 'Den gamle lenken ble deaktivert, men den nye ble ikke opprettet. Trykk «Opprett lenke» for å prøve igjen.')
      }
      loadData(session)
    } catch {
      setInviteError('Kunne ikke fornye invitasjonslenken. Prøv igjen.')
    } finally {
      setDeactivatingId(null)
      setCreatingInvite(false)
    }
  }

  // Selve fjerningen. Bekreftelsen skjer i modalen (se removeTarget) — resten
  // av panelet bruker egne modaler, og window.confirm() skilte seg ut.
  const removeMember = async () => {
    if (!session || !removeTarget) return
    setRemovingId(removeTarget.id)
    setRemoveMemberError(null)
    try {
      const res = await fetch(`/api/org/members/${removeTarget.id}/remove`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setRemoveMemberError(json?.error ?? 'Kunne ikke fjerne medlemmet. Prøv igjen.')
        return
      }
      setRemoveTarget(null)
      loadData(session)
    } catch {
      setRemoveMemberError('Kunne ikke fjerne medlemmet. Prøv igjen.')
    } finally {
      setRemovingId(null)
    }
  }

  // Avbryt en planlagt fjerning. Ingen bekreftelsesmodal: å avbryte gjør
  // ingenting uopprettelig — det er å PLANLEGGE som er den farlige retningen.
  const cancelScheduledRemoval = async (membershipId: string) => {
    if (!session) return
    setCancellingPlanId(membershipId)
    setPlanError(null)
    try {
      const res = await fetch(`/api/org/members/${membershipId}/schedule-removal`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setPlanError(json?.error ?? 'Kunne ikke avbryte planen. Prøv igjen.')
        return
      }
      loadData(session)
    } catch {
      setPlanError('Kunne ikke avbryte planen. Prøv igjen.')
    } finally {
      setCancellingPlanId(null)
    }
  }

  const saveOrgName = async () => {
    if (!session) return
    setSavingName(true)
    setNameSaved(false)
    setNameError(null)
    try {
      const res = await fetch(`/api/org/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ name: orgNameInput }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNameError(json?.error ?? 'Kunne ikke lagre navnet. Prøv igjen.')
        return
      }
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2500)
      loadData(session)
    } catch {
      setNameError('Kunne ikke lagre navnet. Prøv igjen.')
    } finally {
      setSavingName(false)
    }
  }

  const changePlan = async (plan: OrgPlanId) => {
    if (!session || changingPlan) return
    setChangingPlan(plan)
    setPlanChangeError(null)
    setPlanChanged(null)
    try {
      const res = await fetch(`/api/org/${slug}/change-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPlanChangeError(json?.error ?? 'Kunne ikke bytte plan. Prøv igjen.')
        return
      }
      setPlanChanged(json.warning ?? `Planen er endret til ${json.planLabel ?? plan}.`)
      setTimeout(() => setPlanChanged(null), 6000)
      loadData(session)
    } catch {
      setPlanChangeError('Kunne ikke bytte plan. Prøv igjen.')
    } finally {
      setChangingPlan(null)
    }
  }

  const saveSettings = async () => {
    if (!session) return
    setSavingSettings(true)
    setSettingsSaved(false)
    setSettingsError(null)
    try {
      const res = await fetch(`/api/org/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ allow_global_league: allowGlobal }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setSettingsError(json?.error ?? 'Kunne ikke lagre innstillingen. Prøv igjen.')
        return
      }
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } catch {
      setSettingsError('Kunne ikke lagre innstillingen. Prøv igjen.')
    } finally {
      setSavingSettings(false)
    }
  }

  const saveReportTiming = async () => {
    if (!session) return
    setSavingTiming(true)
    setTimingSaved(false)
    setTimingError(null)
    try {
      const res = await fetch(`/api/org/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ weekly_report_timing: reportTiming }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setTimingError(json?.error ?? 'Kunne ikke lagre innstillingen. Prøv igjen.')
        return
      }
      setTimingSaved(true)
      setTimeout(() => setTimingSaved(false), 2500)
    } catch {
      setTimingError('Kunne ikke lagre innstillingen. Prøv igjen.')
    } finally {
      setSavingTiming(false)
    }
  }

  const saveQuizTimes = async () => {
    if (!session) return
    setSavingQuizTimes(true)
    setQuizTimesSaved(false)
    setQuizTimesError(null)
    try {
      const res = await fetch(`/api/org/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          org_quiz_opens_at: orgQuizOpensAt || null,
          org_quiz_closes_at: orgQuizClosesAt || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setQuizTimesError(d.error ?? 'Noe gikk galt. Prøv igjen.')
        return
      }
      setQuizTimesSaved(true)
      setTimeout(() => setQuizTimesSaved(false), 2500)
    } finally {
      setSavingQuizTimes(false)
    }
  }

  const copyWeeklyText = async () => {
    if (!weeklyShareText) return
    try {
      await navigator.clipboard.writeText(weeklyShareText)
      setWeeklyCopied(true)
      setTimeout(() => setWeeklyCopied(false), 2000)
    } catch {
      // clipboard unavailable — silent
    }
  }

  // Toggle global-league and auto-save (button is now repurposed for portal).
  // Toggelen flippes optimistisk, men rulles tilbake hvis PATCH-en feiler —
  // ellers sto den visuelt på «på» mens databasen fortsatt sa «av».
  const toggleGlobal = async () => {
    if (!session || savingSettings) return
    const prev = allowGlobal
    const next = !allowGlobal
    setAllowGlobal(next)
    setSavingSettings(true)
    setSettingsError(null)
    try {
      const res = await fetch(`/api/org/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ allow_global_league: next }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setAllowGlobal(prev)
        setSettingsError(json?.error ?? 'Kunne ikke lagre innstillingen. Prøv igjen.')
      }
    } catch {
      setAllowGlobal(prev)
      setSettingsError('Kunne ikke lagre innstillingen. Prøv igjen.')
    } finally {
      setSavingSettings(false)
    }
  }

  // Open Stripe billing portal for the org
  const openPortal = async () => {
    if (!session || !data) return
    setPortalLoading(true)
    setPortalError(null)
    try {
      const res = await fetch('/api/stripe/org-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ org_id: data.org.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setPortalError('Ikke tilgjengelig i testmodus')
        return
      }
      window.location.href = json.url
    } catch {
      setPortalError('Ikke tilgjengelig i testmodus')
    } finally {
      setPortalLoading(false)
    }
  }

  const handleSetAdmin = async (action: 'add' | 'remove', email?: string, userId?: string) => {
    if (!session) return
    setAdminActionLoading(true)
    setAdminActionError(null)
    setAdminActionSuccess(null)
    try {
      const res = await fetch(`/api/org/${slug}/set-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(email ? { email: email.trim(), action } : { userId, action }),
      })
      const json = await res.json()
      if (!res.ok) {
        setAdminActionError(json.error ?? 'Noe gikk galt')
      } else {
        setAdminActionSuccess(action === 'add' ? 'Admin lagt til' : 'Admin-rolle fjernet')
        loadData(session)
        setTimeout(() => setAdminActionSuccess(null), 3000)
      }
    } catch {
      setAdminActionError('Noe gikk galt. Prøv igjen.')
    } finally {
      setAdminActionLoading(false)
    }
  }

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/bli-med/${token}`
    await navigator.clipboard.writeText(url)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  const shareWinner = (period: 'month' | 'quarter' | 'year') => {
    if (!data) return
    const now = new Date()
    const year = now.getFullYear()
    let periodLabel: string
    if (period === 'month') {
      const mn = now.toLocaleDateString('nb-NO', { month: 'long' })
      periodLabel = `${mn.charAt(0).toUpperCase() + mn.slice(1)} ${year}`
    } else if (period === 'quarter') {
      periodLabel = `Q${Math.floor(now.getMonth() / 3) + 1} ${year}`
    } else {
      periodLabel = `${year}`
    }
    const titleWord = period === 'month' ? 'Månedens' : period === 'quarter' ? 'Kvartalets' : 'Årets'
    const medals = ['🥇', '🥈', '🥉']
    const top3Lines = top3Winners[period].map((e, i) => `${medals[i]} ${e.displayName} — ${e.points} poeng`)
    const mc = data.stats?.memberCount ?? data.members.length
    const ac = data.stats?.activeThisMonth ?? 0
    const pct = mc > 0 ? Math.round((ac / mc) * 100) : 0
    const text = [
      `${titleWord} Quizkanon — ${periodLabel} | ${data.org.name}`,
      '',
      ...top3Lines,
      '',
      `Deltakelse: ${ac} av ${mc} medlemmer (${pct}%)`,
      '',
      'Spill fredagsquizen på quizkanonen.no 🎯',
    ].join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopiedWinner(period)
      setTimeout(() => setCopiedWinner(false), 2000)
    })
  }

  const handleSendInvites = async () => {
    if (!session || !data) return
    const activeInvite = data.invites.find(i => i.is_active)
    if (!activeInvite) { setEmailInviteError('Ingen aktiv invitasjonslenke. Opprett én først.'); return }
    const rawEmails = emailInviteText.split(/[\n,]+/).map(e => e.trim()).filter(Boolean)
    if (rawEmails.length === 0) { setEmailInviteError('Ingen e-postadresser oppgitt.'); return }
    const inviteUrl = `${window.location.origin}/bli-med/${activeInvite.token}`
    // Avsendernavnet sendes ikke lenger med: ruten henter det selv fra profilen,
    // slik at ingen kan skrive vilkårlig tekst inn i en e-post fra oss.
    setEmailInviteSending(true)
    setEmailInviteResult(null)
    setEmailInviteError(null)
    try {
      const res = await fetch(`/api/org/${data.org.id}/send-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ emails: rawEmails, inviteUrl }),
      })
      const json = await res.json()
      if (!res.ok) { setEmailInviteError(json.error ?? 'Noe gikk galt'); return }
      setEmailInviteResult(json)
      setEmailInviteText('')
    } catch {
      setEmailInviteError('Noe gikk galt. Prøv igjen.')
    } finally {
      setEmailInviteSending(false)
    }
  }

  const handleSeasonReset = async () => {
    if (!data || !session || seasonResetting || seasonResetInput !== 'NULLSTILL') return
    setSeasonResetting(true)
    setSeasonResetError(null)
    try {
      const res = await fetch(`/api/org/${data.org.id}/reset-season`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setSeasonResetError(json?.error ?? 'Kunne ikke nullstille sesongen. Prøv igjen.')
        return
      }
      setSeasonResetModal(false)
      setSeasonResetInput('')
      setSeasonResetDone(true)
      setActivityData(null)
      loadWinners(data.org.id, session.access_token)
      setTimeout(() => setSeasonResetDone(false), 4000)
    } catch {
      setSeasonResetError('Kunne ikke nullstille sesongen. Prøv igjen.')
    } finally {
      setSeasonResetting(false)
    }
  }

  const handleDeleteOrg = async () => {
    if (!data || !session || deletingOrg || deleteOrgInput.trim() !== data.org.name) return
    setDeletingOrg(true)
    setDeleteOrgError(null)
    try {
      const res = await fetch(`/api/org/${data.org.id}/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setDeleteOrgError(d.error ?? 'Noe gikk galt. Prøv igjen.')
        return
      }
      router.push('/?melding=org-slettet')
    } catch {
      setDeleteOrgError('Noe gikk galt. Prøv igjen.')
    } finally {
      setDeletingOrg(false)
    }
  }

  const handleExclude = async (userId: string, currentlyExcluded: boolean) => {
    if (!data || !session) return
    setExcludingId(userId)
    try {
      await fetch('/api/admin/exclude-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ scope_type: 'organization', scope_id: data.org.id, user_id: userId, action: currentlyExcluded ? 'unexclude' : 'exclude' }),
      })
      loadActivity(data.org.id, session.access_token, activityPeriod)
    } finally {
      setExcludingId(null)
    }
  }

  const sendReminder = async () => {
    if (!session || !data || reminderSending) return
    // Mottakerne utledes av hvem som IKKE har levert siste quiz. Er ikke det
    // kjent, sendes ingenting: alternativet er å mistolke «vet ikke» som
    // «ingen har spilt» og sende e-post til hele bedriften.
    if (quizError || quizData === null) {
      setReminderMsg({ ok: false, text: 'Vet ikke hvem som har spilt ennå — last siden på nytt og prøv igjen.' })
      setTimeout(() => setReminderMsg(null), 5000)
      return
    }
    const playedIds = new Set(quizData.map(e => e.userId))
    const inactiveIds = data.members.map(m => m.user_id).filter(id => !playedIds.has(id))
    if (inactiveIds.length === 0) {
      setReminderMsg({ ok: false, text: 'Alle medlemmer har allerede spilt.' })
      setTimeout(() => setReminderMsg(null), 4000)
      return
    }
    setReminderSending(true)
    setReminderMsg(null)
    try {
      const res = await fetch(`/api/org/${data.org.id}/send-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ userIds: inactiveIds }),
      })
      const json = await res.json()
      if (!res.ok) {
        setReminderMsg({ ok: false, text: 'Kunne ikke sende — prøv igjen' })
      } else {
        setReminderMsg({ ok: true, text: `Påminnelse sendt til ${json.sent} ${json.sent === 1 ? 'medlem' : 'medlemmer'}` })
      }
    } catch {
      setReminderMsg({ ok: false, text: 'Kunne ikke sende — prøv igjen' })
    } finally {
      setReminderSending(false)
      setTimeout(() => setReminderMsg(null), 4000)
    }
  }

  // Uten res.ok-sjekken ble en 403/500 lastet ned som en .csv-fil med
  // feilmeldingen som innhold — en fil som ser gyldig ut helt til den åpnes.
  const downloadCsv = async () => {
    if (!data || !session || csvLoading) return
    setCsvLoading(true)
    setCsvError(null)
    try {
      const url = `/api/org/${data.org.id}/members-activity?period=${activityPeriod}&format=csv`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setCsvError(json?.error ?? 'Kunne ikke laste ned CSV. Prøv igjen.')
        return
      }
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `aktivitet-${activityPeriod}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch {
      setCsvError('Kunne ikke laste ned CSV. Prøv igjen.')
    } finally {
      setCsvLoading(false)
    }
  }

  // ── Loading / Error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <style>{CSS}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' }}>Laster…</p>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <style>{CSS}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, color: '#ffffff', marginBottom: 10 }}>
              {errorKind === 'access' ? 'Ingen tilgang' : 'Kunne ikke laste bedriftsdata'}
            </p>
            <p style={{ fontSize: 14, color: '#7a7873', marginBottom: 24 }}>{error}</p>
            {errorKind === 'load' && (
              <div style={{ marginBottom: 20 }}>
                <button
                  onClick={retryLoad}
                  style={{
                    padding: '10px 28px', background: '#c9a84c', color: '#1a1c23',
                    border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
                    fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer',
                  }}
                >
                  Prøv igjen
                </button>
              </div>
            )}
            <Link href="/" style={{ fontSize: 13, color: errorKind === 'load' ? '#e8e4dd' : '#c9a84c', textDecoration: 'none' }}>← Forsiden</Link>
          </div>
        </div>
      </>
    )
  }

  // ── Låst org (utløpt trial uten betaling) ──────────────────────────────────
  if (data && session && isOrgLocked(data.org)) {
    return <OrgLockedScreen orgName={data.org.name} orgId={data.org.id} orgSlug={slug} accessToken={session.access_token} />
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const activeInvites   = data?.invites.filter(i => i.is_active) ?? []
  const inactiveInvites = data?.invites.filter(i => !i.is_active) ?? []
  const primaryInvite   = activeInvites[0] ?? null

  const memberCount    = data?.stats?.memberCount ?? data?.members.length ?? 0
  const activeCount    = data?.stats?.activeThisMonth ?? 0
  const activePercent  = memberCount > 0 ? Math.round((activeCount / memberCount) * 100) : 0
  const totalQuizzes   = activityData ? activityData.reduce((s, m) => s + m.quizCount, 0) : null
  const currentPlan    = data?.org.plan ?? ''
  const planMeta       = getPlan(currentPlan)
  const planName       = planMeta?.label ?? (currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1))
  const planLimit      = planMeta?.memberLimit ?? null
  // Teksten sa tidligere «Oppgrader til Standard: opptil 25 deltakere» — 25 er
  // Starter sin grense, ikke Standard sin (50). Tallene kommer nå fra ORG_PLANS,
  // så visning og håndheving ikke kan komme i utakt igjen.
  const upgradeHint    = planLimit !== null
    ? `${planName} rommer ${planLimit} medlemmer. Bedriften har ${memberCount}.`
    : null
  // Planer admin kan bytte til selv. Pro og Enterprise avtales med oss.
  const switchablePlans = PLAN_ORDER
    .filter(p => ORG_PLANS[p].selfServe && p !== currentPlan)
    .map(p => ORG_PLANS[p])
  const renewalDate    = data?.org.stripe_period_end
    ? new Date(data.org.stripe_period_end).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  // Org name split: all but last word plain, last word in gold italic
  const nameWords      = (data?.org.name ?? '').split(' ')
  const nameFront      = nameWords.slice(0, -1).join(' ')
  const nameLast       = nameWords[nameWords.length - 1] ?? ''

  // Activity map keyed by userId for quick lookup
  const activityMap    = new Map((activityData ?? []).map(m => [m.userId, m]))

  // Antall som ikke har levert siste quiz — nøyaktig samme utregning som
  // sendReminder bruker for mottakerlisten, slik at knappeteksten ikke kan
  // vise et annet tall enn det som faktisk sendes.
  // null = ikke kjent ennå (laster, eller hentingen feilet).
  const playedLatestIds = new Set((quizData ?? []).map(e => e.userId))
  const notPlayedCount = quizData === null || quizError
    ? null
    : (data?.members ?? []).filter(m => !playedLatestIds.has(m.user_id)).length

  // Filtered members for search
  const q = memberSearch.toLowerCase()
  const filteredMembers = (data?.members ?? []).filter(m =>
    !q || m.display_name.toLowerCase().includes(q) || (m.nickname ?? '').toLowerCase().includes(q)
  )

  // Toppliste: activityData sorted by totalPoints desc
  const sortedByPoints = [...(activityData ?? [])].sort((a, b) => b.totalPoints - a.totalPoints)

  // Forhåndssjekk for «Forlat organisasjon». Kun et hint til UI-et — leave-ruten
  // håndhever sperren selv (409 last_admin) og er fasiten hvis rollene endrer
  // seg mens siden står åpen. Samme forhold som answer_key_locked: UI-et spør på
  // forhånd, 409-en er backstop for enhver annen kaller.
  // Planlagte fjerninger, nærmeste dato først.
  const scheduledRemovals = (data?.members ?? [])
    .filter(m => !!m.scheduled_removal_at)
    .sort((a, b) => (a.scheduled_removal_at ?? '').localeCompare(b.scheduled_removal_at ?? ''))

  const adminCount   = (data?.members ?? []).filter(m => m.role === 'admin').length
  const myRole       = (data?.members ?? []).find(m => m.user_id === data?.currentUserId)?.role
  const isLastAdmin  = myRole === 'admin' && adminCount <= 1

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{CSS}</style>

      <SiteNav variant="org-admin" orgSlug={slug} orgName={data?.org.name} />

      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div className="oa-page">

          {/* ══════════════════════════════════════════════════════════════════
              1. HERO
          ══════════════════════════════════════════════════════════════════ */}
          <section style={{ paddingTop: 52, paddingBottom: 36 }}>
            <span style={{
              display: 'inline-block',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
              color: '#c9a84c', background: 'rgba(201,168,76,0.10)',
              border: '1px solid rgba(201,168,76,0.25)',
              borderRadius: 999, padding: '4px 12px',
              marginBottom: 18,
            }}>
              Bedriftspanel
            </span>
            <h1 style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 'clamp(28px, 5vw, 40px)',
              fontWeight: 700, color: '#ffffff',
              letterSpacing: '-0.02em', lineHeight: 1.15,
              marginBottom: 12,
            }}>
              {nameFront && <>{nameFront} </>}
              <em style={{ fontStyle: 'italic', color: '#c9a84c' }}>{nameLast}</em>
            </h1>
            <p style={{ fontSize: 15, color: '#e8e4dd', opacity: 0.75, maxWidth: 480, lineHeight: 1.6 }}>
              Administrer medlemmer, følg med på sesongresultater og inviter nye deltakere.
            </p>
          </section>

          {/* ══════════════════════════════════════════════════════════════════
              2. STATISTIKK-STRIP
          ══════════════════════════════════════════════════════════════════ */}
          <div className="oa-stats-strip" style={{ display: 'flex', gap: 12, marginBottom: 20 }}>

            <div className="oa-stat">
              <p style={{ fontSize: 11, color: '#7a7873', letterSpacing: '0.04em', marginBottom: 8 }}>Medlemmer</p>
              <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>
                {memberCount}
              </p>
            </div>

            <div className="oa-stat">
              <p style={{ fontSize: 11, color: '#7a7873', letterSpacing: '0.04em', marginBottom: 8 }}>Aktive denne måneden</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#4ade80', lineHeight: 1 }}>
                  {activeCount}
                </p>
                {activePercent > 0 && (
                  <span style={{ fontSize: 13, color: '#4ade80', opacity: 0.7 }}>{activePercent}%</span>
                )}
              </div>
            </div>

            <div className="oa-stat">
              <p style={{ fontSize: 11, color: '#7a7873', letterSpacing: '0.04em', marginBottom: 8 }}>Quizer spilt denne måneden</p>
              <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#c9a84c', lineHeight: 1 }}>
                {totalQuizzes ?? '—'}
              </p>
            </div>

            <div className="oa-stat">
              <p style={{ fontSize: 11, color: '#7a7873', letterSpacing: '0.04em', marginBottom: 8 }}>Abonnement</p>
              <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>
                {planName || '—'}
              </p>
            </div>

          </div>

          {/* ══════════════════════════════════════════════════════════════════
              UKENS OPPSUMMERING — kun Standard-plan
          ══════════════════════════════════════════════════════════════════ */}
          {data?.org.plan === 'standard' && (weeklyLoading || weeklySummary) && (
            <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: 28, marginBottom: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 12 }}>
                Ukens oppsummering
              </p>

              {weeklyLoading && !weeklySummary ? (
                <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic' }}>Laster…</p>
              ) : weeklySummary ? (
                <>
                  <h2 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', lineHeight: 1.25, marginBottom: 4 }}>
                    {weeklySummary.winner
                      ? <>{weeklySummary.winner.displayName} <span style={{ color: '#c9a84c' }}>vant {weeklySummary.quizTitle}</span></>
                      : <>{weeklySummary.quizTitle} er avgjort</>}
                  </h2>
                  {weeklySummary.winner && (
                    <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 18 }}>
                      {weeklySummary.winner.correct}/{weeklySummary.winner.total} riktige
                    </p>
                  )}

                  {weeklySummary.top3.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                      {weeklySummary.top3.map((e, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>
                            {['🥇', '🥈', '🥉'][i]}
                          </span>
                          <span style={{ fontSize: 14, color: '#ffffff', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.displayName}
                          </span>
                          <span style={{ fontSize: 14, color: '#c9a84c', fontWeight: 600, flexShrink: 0 }}>
                            {e.correct}/{e.total}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 18 }}>
                    {weeklySummary.participantCount} ansatte kjempet om ukens seier.
                  </p>

                  {weeklyShareText && (
                    <>
                      <pre style={{
                        background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 12,
                        padding: '16px 18px', fontSize: 13, lineHeight: 1.6, color: '#e8e4dd',
                        fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word', margin: '0 0 14px',
                      }}>
                        {weeklyShareText}
                      </pre>
                      <button
                        onClick={copyWeeklyText}
                        style={{
                          padding: '10px 28px', background: '#c9a84c', color: '#1a1c23',
                          border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
                          fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer',
                        }}
                      >
                        {weeklyCopied ? 'Kopiert!' : 'Kopier tekst'}
                      </button>
                    </>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              KOM I GANG — onboarding for nye admins (kun når listen er tom)
          ══════════════════════════════════════════════════════════════════ */}
          {memberCount === 1 && (
            <div style={{
              background: '#21242e',
              border: '1px solid rgba(201,168,76,0.3)',
              borderRadius: 14,
              padding: '20px 22px',
              marginBottom: 20,
            }}>
              <p style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
                textTransform: 'uppercase', color: '#7a7873', marginBottom: 10,
              }}>
                Kom i gang
              </p>
              <p style={{
                fontFamily: "'Libre Baskerville', serif",
                fontSize: 20, fontWeight: 700, color: '#ffffff',
                marginBottom: 10, lineHeight: 1.3,
              }}>
                Inviter dine første deltakere
              </p>
              <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 18 }}>
                Opprett en invitasjonslenke og del den i Slack, Teams eller på e-post.
                Alle som klikker lenken blir automatisk medlem.
              </p>
              <a
                href="#invite-section"
                style={{
                  display: 'inline-block',
                  padding: '10px 28px',
                  background: '#c9a84c',
                  color: '#1a1c23',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  textDecoration: 'none',
                  fontFamily: "'Instrument Sans', sans-serif",
                }}
              >
                Opprett invitasjonslenke →
              </a>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              3. PLAN-BANNER
          ══════════════════════════════════════════════════════════════════ */}
          <div style={{
            background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)',
            borderRadius: 14, padding: '18px 22px',
            marginBottom: 20,
          }}>
            {/* Top row: plan info + buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: '#c9a84c',
                    background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)',
                    borderRadius: 999, padding: '2px 9px',
                  }}>
                    {planName || 'Plan'}
                  </span>
                  {renewalDate && (
                    <span style={{ fontSize: 12, color: '#7a7873' }}>Fornyes {renewalDate}</span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: '#e8e4dd' }}>
                  Bedriftsabonnement for {data?.org.name}
                </p>
                {upgradeHint && (
                  <p style={{ fontSize: 12, color: '#7a7873', marginTop: 4 }}>
                    {upgradeHint}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  style={{
                    padding: '8px 18px', background: 'transparent',
                    border: '1px solid #2a2d38', borderRadius: 10,
                    fontSize: 13, fontWeight: 600, color: '#e8e4dd',
                    fontFamily: "'Instrument Sans', sans-serif", cursor: portalLoading ? 'not-allowed' : 'pointer',
                    transition: 'border-color 0.15s', whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { if (!portalLoading) e.currentTarget.style.borderColor = '#c9a84c' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
                >
                  {portalLoading ? 'Laster...' : 'Innstillinger'}
                </button>
                </div>
                {data?.org.subscription_status === 'trialing' && (
                  <button
                    onClick={openPortal}
                    disabled={portalLoading}
                    style={{ fontSize: 12, color: '#7a7873', background: 'transparent', border: 'none', padding: 0, cursor: portalLoading ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", textDecoration: 'underline', textAlign: 'right' }}
                  >
                    Legg inn betaling for å fortsette etter prøveperioden
                  </button>
                )}
                {portalError && (
                  <p style={{ fontSize: 12, color: '#7a7873', margin: 0 }}>{portalError}</p>
                )}
              </div>
            </div>

            {/* ── Bytt plan ─────────────────────────────────────────────────
                Erstatter den tidligere «Oppgrader →»-lenken, som pekte på
                /kontakt — en side som ikke finnes (404). Nedgradering under
                medlemstallet blokkeres av ruten med en forklaring som sier
                nøyaktig hvor mange som må fjernes først. */}
            {switchablePlans.length > 0 && data?.org.subscription_status !== 'trialing' && (
              <div style={{ borderTop: '1px solid rgba(201,168,76,0.15)', marginTop: 14, paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: '#e8e4dd', whiteSpace: 'nowrap' }}>Bytt plan</span>
                  {switchablePlans.map(p => (
                    <button
                      key={p.id}
                      onClick={() => changePlan(p.id)}
                      disabled={!!changingPlan}
                      style={{
                        padding: '8px 18px', background: 'transparent',
                        border: '1px solid #2a2d38', borderRadius: 10,
                        fontSize: 13, fontWeight: 600, color: '#e8e4dd',
                        fontFamily: "'Instrument Sans', sans-serif",
                        cursor: changingPlan ? 'not-allowed' : 'pointer',
                        opacity: changingPlan && changingPlan !== p.id ? 0.5 : 1,
                        whiteSpace: 'nowrap', transition: 'border-color 0.15s',
                      }}
                      onMouseEnter={e => { if (!changingPlan) e.currentTarget.style.borderColor = '#c9a84c' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
                    >
                      {changingPlan === p.id
                        ? 'Bytter…'
                        : `${p.label} — ${p.priceNok} kr/mnd${p.memberLimit !== null ? ` · ${p.memberLimit} medlemmer` : ''}`}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: '#7a7873', marginTop: 8, lineHeight: 1.5 }}>
                  Endringen slår inn med én gang. Du betaler eller krediteres differansen for resten av perioden.
                </p>
                {planChangeError && (
                  <p style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '10px 14px', marginTop: 10, lineHeight: 1.5 }}>
                    {planChangeError}
                  </p>
                )}
                {planChanged && (
                  <p style={{ fontSize: 13, color: '#4ade80', marginTop: 10 }}>{planChanged}</p>
                )}
              </div>
            )}

            {/* Toggle row — inside banner, separated by a subtle divider */}
            <div style={{ borderTop: '1px solid rgba(201,168,76,0.15)', marginTop: 14, paddingTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                onClick={toggleGlobal}
                aria-disabled={savingSettings}
                style={{ width: 28, height: 16, borderRadius: 8, background: allowGlobal ? '#c9a84c' : '#2a2d38', border: `1px solid ${allowGlobal ? '#c9a84c' : '#3a3d48'}`, position: 'relative', flexShrink: 0, cursor: 'pointer', transition: 'background 0.2s' }}
              >
                <div style={{ position: 'absolute', top: 2, left: allowGlobal ? 13 : 2, width: 10, height: 10, borderRadius: '50%', background: '#ffffff', transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: 13, color: '#e8e4dd', cursor: 'pointer' }} onClick={toggleGlobal}>
                Delta i global sesong-toppliste
              </span>
              <span style={{ fontSize: 12, color: '#7a7873', marginLeft: 4 }}>
                — Tillat at ansatte vises på felles sesong-toppliste
              </span>
            </div>

            {settingsError && (
              <p style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '10px 14px', marginTop: 12, lineHeight: 1.5 }}>
                {settingsError}
              </p>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              4. MEDLEMSSEKSJON
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel
            title="Medlemmer"
            right={
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={downloadCsv}
                    disabled={csvLoading}
                    style={{ fontSize: 11, fontWeight: 600, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: csvLoading ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    {csvLoading ? 'Laster ned…' : 'Last ned CSV'}
                  </button>
                  <button
                    onClick={sendReminder}
                    disabled={reminderSending}
                    style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '6px 14px', cursor: reminderSending ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    {/* Sa tidligere «Send påminnelse til inaktive». Ordet
                        «inaktiv» betydde da noe annet enn AKTIV-merket rett
                        under: admin så 20 grønne merker, trykket, og fikk
                        «sendt til 18». Teksten sier nå nøyaktig hva knappen
                        gjør, og tallet er samme utregning som mottakerlisten. */}
                    {reminderSending
                      ? 'Sender...'
                      : notPlayedCount === null
                        ? 'Minn på ukens quiz'
                        : `Minn på ukens quiz (${notPlayedCount} har ikke spilt)`}
                  </button>
                </div>
                {reminderMsg && (
                  <p style={{ fontSize: 12, color: reminderMsg.ok ? '#4ade80' : '#c94c4c', margin: 0 }}>
                    {reminderMsg.text}
                  </p>
                )}
                {csvError && (
                  <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{csvError}</p>
                )}
              </div>
            }
          />

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, overflow: 'hidden' }}>

            {/* Search + count */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #2a2d38' }}>
              <input
                type="text"
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                placeholder="Søk etter navn…"
                className="oa-input"
                style={{ flex: 1, fontSize: 13 }}
              />
              <span style={{
                fontSize: 12,
                color: planLimit !== null && memberCount >= planLimit ? '#f87171' : '#7a7873',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {planLimit !== null
                  ? `${memberCount} av ${planLimit} plasser`
                  : `${memberCount} deltaker${memberCount !== 1 ? 'e' : ''}`}
              </span>
            </div>

            {/* Member rows */}
            {filteredMembers.length === 0 ? (
              <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', padding: '20px 18px' }}>
                {memberSearch ? 'Ingen treff.' : 'Ingen medlemmer ennå.'}
              </p>
            ) : (
              filteredMembers.map((member, idx) => {
                const isMe     = member.user_id === data?.currentUserId
                const isAdmin  = member.role === 'admin'
                const activity = activityMap.get(member.user_id)
                const isLast   = idx === filteredMembers.length - 1

                return (
                  <div
                    key={member.id}
                    onMouseEnter={() => setHoveredMemberId(member.id)}
                    onMouseLeave={() => setHoveredMemberId(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 18px',
                      borderBottom: isLast ? 'none' : '1px solid rgba(42,45,56,0.6)',
                    }}
                  >
                    <Avatar name={member.display_name} size={36} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: isMe ? '#c9a84c' : '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                          {member.nickname?.trim() || member.display_name}
                        </span>
                        {isAdmin && <Tag label="Admin" color="gold" />}
                        {isMe && <Tag label="deg" color="muted" />}
                        {activity?.activeLast30Days && (
                          <Tag label="Aktiv" color="green" title="Har levert minst én quiz de siste 30 dagene" />
                        )}
                        {member.scheduled_removal_at && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center',
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                            padding: '2px 7px', borderRadius: 999,
                            background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.28)',
                            color: '#f87171', textTransform: 'uppercase', flexShrink: 0,
                          }}>
                            Fjernes {formatRemovalDate(member.scheduled_removal_at)}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 11, color: '#7a7873', marginTop: 2 }}>
                        {member.nickname?.trim() && <>{member.display_name} · </>}
                        Ble med {new Date(member.joined_at).toLocaleDateString('nb-NO')}
                        {activity && ` · ${activity.totalPoints} poeng`}
                        {(() => {
                          const s = streaks.get(member.user_id) ?? 0
                          if (s < 2) return null
                          return <span style={{ color: '#c9a84c' }}>{` · streak: ${s} uker`}</span>
                        })()}
                      </p>
                    </div>

                    {/* Action buttons */}
                    {!isMe && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {/* Admin toggle: always visible for existing admins; hover-only for promotion */}
                        {isAdmin ? (
                          <button
                            onClick={() => handleSetAdmin('remove', undefined, member.user_id)}
                            disabled={adminActionLoading}
                            style={{ fontSize: 11, fontWeight: 600, color: '#c9a84c', background: 'transparent', border: '0.5px solid rgba(201,168,76,0.3)', borderRadius: 6, padding: '4px 10px', cursor: adminActionLoading ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
                          >
                            Admin
                          </button>
                        ) : hoveredMemberId === member.id ? (
                          <button
                            onClick={() => handleSetAdmin('add', undefined, member.user_id)}
                            disabled={adminActionLoading}
                            style={{ fontSize: 11, fontWeight: 600, color: '#7a7873', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: adminActionLoading ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
                          >
                            Gjør admin
                          </button>
                        ) : null}
                        {!member.scheduled_removal_at && (
                          <button
                            onClick={() => setScheduleTarget(member)}
                            style={{ fontSize: 11, fontWeight: 600, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
                          >
                            Planlegg
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setRemoveTarget({ id: member.id, name: member.nickname?.trim() || member.display_name })
                            setRemoveMemberError(null)
                          }}
                          disabled={removingId === member.id}
                          style={{ fontSize: 11, fontWeight: 600, color: '#f87171', background: 'transparent', border: '0.5px solid rgba(248,113,113,0.35)', borderRadius: 6, padding: '4px 10px', cursor: removingId === member.id ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
                        >
                          {removingId === member.id ? '…' : 'Fjern'}
                        </button>
                        {activity && (
                          <button
                            onClick={() => handleExclude(member.user_id, activity.isExcluded)}
                            disabled={excludingId === member.user_id}
                            style={{
                              fontSize: 11, fontWeight: 600,
                              color: activity.isExcluded ? '#c9a84c' : '#fb923c',
                              background: 'transparent',
                              border: activity.isExcluded ? '0.5px solid #2a2d38' : '0.5px solid rgba(251,146,60,0.35)',
                              borderRadius: 6, padding: '4px 10px',
                              cursor: excludingId === member.user_id ? 'not-allowed' : 'pointer',
                              fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap',
                            }}
                          >
                            {excludingId === member.user_id ? '…' : activity.isExcluded ? 'Vis igjen' : 'Ekskluder'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}

            {adminActionError && (
              <p style={{ fontSize: 12, color: '#f87171', padding: '0 18px 12px' }}>{adminActionError}</p>
            )}
            {adminActionSuccess && (
              <p style={{ fontSize: 12, color: '#4ade80', padding: '0 18px 12px' }}>{adminActionSuccess}</p>
            )}

            {/* ── Invite section ─────────────────────────────────────────── */}
            <div id="invite-section" style={{ borderTop: '1px solid #2a2d38', padding: '16px 18px' }}>

              <p style={{ fontSize: 13, color: '#e8e4dd', marginBottom: 12, lineHeight: 1.5 }}>
                Del lenken i Slack, Teams eller på e-post — alle som klikker blir automatisk medlem.
              </p>

              {/* RAD 1 — Delbar invitasjonslenke */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#7a7873', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  Invitasjonslenke — del med ansatte
                </span>
                {primaryInvite ? (
                  <>
                    <input
                      readOnly
                      value={`${typeof window !== 'undefined' ? window.location.origin : ''}/bli-med/${primaryInvite.token}`}
                      className="oa-input"
                      style={{ flex: 1, minWidth: 120, fontSize: 13, color: '#e8e4dd', cursor: 'text' }}
                      onFocus={e => e.currentTarget.select()}
                    />
                    <button
                      onClick={() => copyLink(primaryInvite.token)}
                      style={{
                        padding: '8px 14px', background: 'transparent',
                        border: `1px solid ${copiedToken === primaryInvite.token ? 'rgba(74,222,128,0.4)' : '#2a2d38'}`,
                        borderRadius: 8, fontSize: 12, fontWeight: 600,
                        color: copiedToken === primaryInvite.token ? '#4ade80' : '#e8e4dd',
                        cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif",
                        whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {copiedToken === primaryInvite.token ? 'Kopiert ✓' : 'Kopier'}
                    </button>
                    <button
                      onClick={() => renewInvite(primaryInvite.id)}
                      disabled={deactivatingId === primaryInvite.id || creatingInvite}
                      style={{
                        padding: '8px 14px', background: 'transparent',
                        border: '0.5px solid #2a2d38', borderRadius: 8,
                        fontSize: 12, color: '#7a7873',
                        cursor: (deactivatingId === primaryInvite.id || creatingInvite) ? 'not-allowed' : 'pointer',
                        fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {(deactivatingId === primaryInvite.id || creatingInvite) ? '…' : 'Ny lenke'}
                    </button>
                  </>
                ) : (
                  <>
                    <p style={{ width: '100%', fontSize: 13, color: '#7a7873', marginTop: 4 }}>
                      Ingen aktiv invitasjonslenke ennå.
                    </p>
                    <button
                      onClick={createInvite}
                      disabled={creatingInvite}
                      style={{
                        padding: '8px 14px', background: 'transparent',
                        border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8,
                        fontSize: 12, fontWeight: 600, color: '#c9a84c',
                        cursor: creatingInvite ? 'not-allowed' : 'pointer',
                        fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {creatingInvite ? 'Oppretter…' : '+ Opprett lenke'}
                    </button>
                  </>
                )}
              </div>

              {inviteError && (
                <p style={{ fontSize: 12, color: '#f87171', marginTop: 10, lineHeight: 1.5 }}>{inviteError}</p>
              )}

              {/* RAD 2 — Inviter via e-post (kollapset som standard) */}
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() => { setEmailInviteOpen(o => !o); setEmailInviteResult(null); setEmailInviteError(null) }}
                  style={{ fontSize: 12, color: '#7a7873', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", padding: 0 }}
                >
                  + Inviter via e-post
                </button>
                {emailInviteOpen && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <textarea
                      value={emailInviteText}
                      onChange={e => { setEmailInviteText(e.target.value); setEmailInviteResult(null); setEmailInviteError(null) }}
                      placeholder="e-post til ansatt..."
                      rows={2}
                      style={{ flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none', resize: 'none' }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#c9a84c' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
                    />
                    <button
                      onClick={handleSendInvites}
                      disabled={emailInviteSending || !emailInviteText.trim()}
                      style={{
                        padding: '9px 18px',
                        background: emailInviteSending || !emailInviteText.trim() ? 'transparent' : '#c9a84c',
                        border: `1px solid ${emailInviteSending || !emailInviteText.trim() ? '#2a2d38' : '#c9a84c'}`,
                        borderRadius: 8, fontSize: 13, fontWeight: 700,
                        color: emailInviteSending || !emailInviteText.trim() ? '#7a7873' : '#1a1c23',
                        cursor: emailInviteSending || !emailInviteText.trim() ? 'not-allowed' : 'pointer',
                        fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {emailInviteSending ? 'Sender…' : 'Send invitasjon →'}
                    </button>
                  </div>
                )}
                {emailInviteResult && (
                  <p style={{ fontSize: 12, color: '#4ade80', marginTop: 8 }}>
                    Sendt til {emailInviteResult.sent} mottaker{emailInviteResult.sent !== 1 ? 'e' : ''}.
                    {emailInviteResult.failed.length > 0 && (
                      <span style={{ color: '#f87171' }}> Feilet: {emailInviteResult.failed.join(', ')}</span>
                    )}
                  </p>
                )}
                {emailInviteError && (
                  <p style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>{emailInviteError}</p>
                )}
              </div>

            </div>

          </div>

          {/* ══════════════════════════════════════════════════════════════════
              PLANLAGT FJERNING — vises kun når noe faktisk er planlagt
          ══════════════════════════════════════════════════════════════════ */}
          {scheduledRemovals.length > 0 && (
            <>
              <SectionLabel title="Planlagt fjerning" />
              <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, overflow: 'hidden' }}>
                <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, padding: '16px 18px', borderBottom: '1px solid #2a2d38' }}>
                  Disse fjernes automatisk på datoen. Du kan avbryte eller endre dato helt fram til den utløser.
                </p>

                {scheduledRemovals.map((m, idx) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                      borderBottom: idx === scheduledRemovals.length - 1 ? 'none' : '1px solid rgba(42,45,56,0.6)',
                    }}
                  >
                    <Avatar name={m.display_name} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.nickname?.trim() || m.display_name}
                      </p>
                      <p style={{ fontSize: 12, color: '#7a7873', marginTop: 2 }}>
                        Fjernes {formatRemovalDate(m.scheduled_removal_at!)}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => setScheduleTarget(m)}
                        style={{ fontSize: 11, fontWeight: 600, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
                      >
                        Endre dato
                      </button>
                      <button
                        onClick={() => cancelScheduledRemoval(m.id)}
                        disabled={cancellingPlanId === m.id}
                        style={{ fontSize: 11, fontWeight: 600, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: cancellingPlanId === m.id ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
                      >
                        {cancellingPlanId === m.id ? '…' : 'Avbryt'}
                      </button>
                    </div>
                  </div>
                ))}

                {planError && (
                  <p style={{ fontSize: 12, color: '#f87171', padding: '0 18px 12px' }}>{planError}</p>
                )}
              </div>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              5. TOPPLISTE-SEKSJON
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel title="Toppliste" />

          {/* Top-level tabs: Siste quiz / Sesong */}
          <div className="oa-tab-row" style={{ marginBottom: 0 }}>
            <button
              className={topTab === 'quiz' ? 'oa-tab-a' : 'oa-tab-i'}
              onClick={() => {
                setTopTab('quiz')
                if (data && session) loadQuizLeaderboard(data.org.id, session.access_token)
              }}
            >
              Siste quiz
            </button>
            <button
              className={topTab === 'season' ? 'oa-tab-a' : 'oa-tab-i'}
              onClick={() => setTopTab('season')}
            >
              Sesong
            </button>
          </div>

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>

            {topTab === 'quiz' ? (
              <>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #2a2d38' }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>
                    {quizTitle ? `Siste quiz — ${quizTitle}` : 'Siste quiz'}
                  </p>
                  <span style={{ fontSize: 12, color: '#7a7873', flexShrink: 0, marginLeft: 8 }}>
                    {quizError ? '—' : `${(quizData ?? []).length} deltakere`}
                  </span>
                </div>

                {quizLoading ? (
                  <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', padding: '20px 18px' }}>Laster…</p>
                ) : quizError ? (
                  /* «Ingen har spilt ennå» ville vært en ren løgn her — vi vet
                     ikke om noen har spilt, hentingen feilet. */
                  <div style={{ padding: '28px 24px', textAlign: 'center' }}>
                    <p style={{ fontSize: 13, color: '#e8e4dd', marginBottom: 14, lineHeight: 1.5 }}>
                      Kunne ikke hente resultatene fra siste quiz.
                    </p>
                    <button
                      onClick={() => { if (data && session) loadQuizLeaderboard(data.org.id, session.access_token) }}
                      style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd', background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 28px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
                    >
                      Prøv igjen
                    </button>
                  </div>
                ) : !quizData || quizData.length === 0 ? (
                  <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#2a2d38" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 14, display: 'block', margin: '0 auto 14px' }}>
                      <rect x="3" y="10" width="6" height="14" rx="1"/>
                      <rect x="13" y="5" width="6" height="19" rx="1"/>
                      <rect x="23" y="14" width="6" height="10" rx="1"/>
                    </svg>
                    <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#ffffff', marginBottom: 6 }}>
                      Ingen har spilt ennå
                    </p>
                    <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 18, lineHeight: 1.5 }}>
                      Send en påminnelse til teamet så snart quizen åpner.
                    </p>
                    <button
                      onClick={sendReminder}
                      disabled={reminderSending}
                      style={{ fontSize: 13, fontWeight: 600, color: '#c9a84c', background: 'transparent', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8, padding: '8px 18px', cursor: reminderSending ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
                    >
                      {reminderSending ? 'Sender…' : 'Send påminnelse →'}
                    </button>
                  </div>
                ) : (
                  /* Samme tabell som Dennis bruker på /admin/quizzes/[id]/results,
                     via den delte ResultsTable-komponenten — men scopet til kun
                     denne bedriftens medlemmer (quiz-scores-ruten filtrerer på
                     organization_members). embedded: fane-boksen rundt har
                     allerede bakgrunn, ramme og avrunding. */
                  <ResultsTable
                    embedded
                    formatTime={formatTime}
                    rows={quizData.map((entry, idx) => ({
                      key: entry.userId,
                      rank: idx + 1,
                      name: entry.displayName,
                      correctAnswers: entry.correctAnswers,
                      totalTimeMs: entry.totalTimeMs,
                      highlight: entry.userId === data?.currentUserId,
                    }))}
                  />
                )}
              </>
            ) : (
              <>
                {/* Season period tabs — inside card */}
                <div className="oa-tab-row" style={{ borderRadius: 0 }}>
                  {(['month', 'quarter', 'year'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setActivityPeriod(p)}
                      className={activityPeriod === p ? 'oa-tab-a' : 'oa-tab-i'}
                    >
                      {p === 'month' ? 'Måned' : p === 'quarter' ? 'Kvartal' : 'År'}
                    </button>
                  ))}
                </div>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #2a2d38' }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                    Intern rangering — kun {data?.org.name}
                  </p>
                  <span style={{ fontSize: 12, color: '#7a7873' }}>
                    {sortedByPoints.filter(m => m.totalPoints > 0).length} deltakere
                  </span>
                </div>

                {activityLoading ? (
                  <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', padding: '20px 18px' }}>Laster…</p>
                ) : sortedByPoints.filter(m => m.totalPoints > 0).length === 0 ? (
                  <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', padding: '20px 18px' }}>Ingen data for denne perioden.</p>
                ) : (
                  sortedByPoints.filter(m => m.totalPoints > 0).map((m, idx) => {
                    const rank = idx + 1
                    const rankColor = rank === 1 ? 'oa-rank-gold' : rank === 2 ? 'oa-rank-silver' : rank === 3 ? 'oa-rank-bronze' : undefined
                    const isMe = data?.members.find(mem => mem.user_id === m.userId)?.user_id === data?.currentUserId
                    return (
                      <div
                        key={m.userId}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '11px 18px',
                          borderBottom: idx < sortedByPoints.filter(x => x.totalPoints > 0).length - 1 ? '1px solid rgba(42,45,56,0.6)' : 'none',
                          background: isMe ? 'rgba(201,168,76,0.04)' : 'transparent',
                        }}
                      >
                        <span
                          className={rankColor}
                          style={{ width: 24, textAlign: 'center', fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: rankColor ? undefined : '#7a7873', flexShrink: 0 }}
                        >
                          {rank}
                        </span>
                        {prevRanks !== null && prevRanks.size > 0 && (() => {
                          const prevRank = prevRanks.get(m.userId)
                          if (prevRank === undefined) {
                            return <span style={{ fontSize: 10, fontWeight: 700, color: '#c9a84c', letterSpacing: '0.04em', width: 26, textAlign: 'center', flexShrink: 0 }}>NY</span>
                          }
                          const diff = prevRank - rank
                          if (diff > 0) return <span style={{ fontSize: 11, fontWeight: 700, color: '#e8e4dd', width: 26, textAlign: 'center', flexShrink: 0 }}>↑{diff}</span>
                          if (diff < 0) return <span style={{ fontSize: 11, fontWeight: 700, color: '#c94c4c', width: 26, textAlign: 'center', flexShrink: 0 }}>↓{Math.abs(diff)}</span>
                          return <span style={{ width: 26, flexShrink: 0, display: 'inline-block' }} />
                        })()}
                        <Avatar name={m.displayName} size={30} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: isMe ? '#c9a84c' : '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                              {m.displayName}
                            </span>
                            {isMe && <Tag label="deg" color="muted" />}
                            {m.role === 'admin' && <Tag label="Admin" color="gold" />}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: rank <= 3 ? '#c9a84c' : '#e8e4dd' }}>
                            {m.totalPoints}
                          </span>
                          <span style={{ fontSize: 11, color: '#7a7873', marginLeft: 4 }}>poeng</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </>
            )}
          </div>

          <div style={{ textAlign: 'right', marginTop: 10 }}>
            <a href={`/org/${slug}`} style={{ fontSize: 12, color: '#e8e4dd', textDecoration: 'none' }}>
              Se full toppliste →
            </a>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              6. UKENS INNSIKT
          ══════════════════════════════════════════════════════════════════ */}
          {!insightsLoading && insightsData && (
            <>
              <SectionLabel title="Ukens innsikt" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>

                {/* Easiest */}
                <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '20px 18px' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 12 }}>
                    Flest fikk dette rett
                  </p>
                  <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: '#ffffff', lineHeight: 1.4, marginBottom: 10 }}>
                    {insightsData.easiest.questionText}
                  </p>
                  <p style={{ fontSize: 13, color: '#e8e4dd', fontWeight: 600 }}>
                    {insightsData.easiest.correctPct}% svarte riktig
                  </p>
                </div>

                {/* Hardest */}
                <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '20px 18px' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 12 }}>
                    Vanskeligste spørsmål
                  </p>
                  {insightsData.hardest.map((q, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
                        marginBottom: i < insightsData.hardest.length - 1 ? 10 : 0,
                        paddingBottom: i < insightsData.hardest.length - 1 ? 10 : 0,
                        borderBottom: i < insightsData.hardest.length - 1 ? '1px solid rgba(42,45,56,0.6)' : 'none',
                      }}
                    >
                      <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.4, flex: 1, margin: 0 }}>
                        {q.questionText.length > 60 ? q.questionText.slice(0, 60) + '…' : q.questionText}
                      </p>
                      <span style={{ fontSize: 12, color: '#c94c4c', fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>
                        {q.correctPct}%
                      </span>
                    </div>
                  ))}
                </div>

              </div>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              7. SESONGVINNERE
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel title="Sesongvinnere" />

          <div className="oa-winners-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 8 }}>
            {([
              { label: 'Månedens kanon',   icon: '★', winner: winners?.month,   period: 'month'   as const },
              { label: 'Kvartalets kanon', icon: '◆', winner: winners?.quarter, period: 'quarter' as const },
              { label: 'Årets kanon',      icon: '♛', winner: winners?.year,    period: 'year'    as const },
            ] as { label: string; icon: string; winner: WinnerEntry | undefined; period: 'month' | 'quarter' | 'year' }[]).map(({ label, icon, winner, period }) => (
              <div
                key={label}
                style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '20px 18px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
                  <span style={{ fontSize: 14, color: '#c9a84c' }}>{icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7873' }}>
                    {label}
                  </span>
                </div>
                {winner === undefined ? (
                  <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic' }}>Laster…</p>
                ) : winner === null ? (
                  <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic' }}>Ikke kåret ennå</p>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={winner.displayName} size={36} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {winner.displayName}
                      </p>
                      <p style={{ fontSize: 12, color: '#c9a84c', fontWeight: 600 }}>{winner.points} poeng</p>
                      <button
                        onClick={() => shareWinner(period)}
                        onMouseEnter={() => setShareHovered(period)}
                        onMouseLeave={() => setShareHovered(false)}
                        style={{
                          display: 'inline-block', marginTop: 8, fontSize: 11, padding: '4px 12px',
                          border: `1px solid ${shareHovered === period || copiedWinner === period ? '#c9a84c' : '#2a2d38'}`,
                          borderRadius: 6, background: 'transparent',
                          color: copiedWinner === period ? '#e8e4dd' : shareHovered === period ? '#c9a84c' : '#7a7873',
                          cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif",
                          transition: 'color 0.15s, border-color 0.15s',
                        }}
                      >
                        {copiedWinner === period ? 'Kopiert! ✓' : 'Del med teamet'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              BEDRIFTSNAVN — kunne tidligere ikke endres i det hele tatt
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel title="Bedriftsnavn" />

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '24px 22px', marginBottom: 8 }}>
            <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 18 }}>
              Navnet vises på bedriftstopplisten og i alle e-poster vi sender til de ansatte.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={orgNameInput}
                onChange={e => { setOrgNameInput(e.target.value); setNameError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') saveOrgName() }}
                maxLength={60}
                className="oa-input"
                style={{ flex: 1, minWidth: 200, fontSize: 14 }}
              />
              <button
                onClick={saveOrgName}
                disabled={savingName || !orgNameInput.trim() || orgNameInput.trim() === data?.org.name}
                style={{
                  padding: '10px 28px', background: 'transparent',
                  border: '1px solid #e8e4dd', borderRadius: 10,
                  fontSize: 13, fontWeight: 600, color: '#e8e4dd',
                  fontFamily: "'Instrument Sans', sans-serif",
                  cursor: savingName || !orgNameInput.trim() || orgNameInput.trim() === data?.org.name ? 'not-allowed' : 'pointer',
                  opacity: savingName || !orgNameInput.trim() || orgNameInput.trim() === data?.org.name ? 0.5 : 1,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {savingName ? 'Lagrer…' : 'Lagre navn'}
              </button>
            </div>
            {nameSaved && (
              <p style={{ fontSize: 13, color: '#4ade80', marginTop: 12 }}>Navnet er lagret</p>
            )}
            {nameError && (
              <p style={{ fontSize: 13, color: '#f87171', marginTop: 12, lineHeight: 1.5 }}>{nameError}</p>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              UKENTLIG RAPPORT — innstilling for når oppsummeringen sendes
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel title="Ukentlig rapport" />

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '24px 22px', marginBottom: 8 }}>
            <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 18 }}>
              Velg når du vil motta ukens oppsummering på e-post
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
              {([
                { value: 'after_quiz',        label: 'Rett etter quiz stenger' },
                { value: 'saturday_morning',  label: 'Lørdag morgen' },
                { value: 'monday_morning',    label: 'Mandag morgen' },
              ] as { value: string; label: string }[]).map(({ value, label }) => {
                const selected = reportTiming === value
                return (
                  <label
                    key={value}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                    onClick={() => setReportTiming(value)}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `1px solid ${selected ? '#c9a84c' : '#3a3d48'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'border-color 0.15s',
                    }}>
                      {selected && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#c9a84c' }} />}
                    </span>
                    <span style={{ fontSize: 14, color: '#e8e4dd' }}>{label}</span>
                  </label>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={saveReportTiming}
                disabled={savingTiming}
                style={{
                  padding: '10px 28px', background: '#c9a84c', color: '#1a1c23',
                  border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
                  fontFamily: "'Instrument Sans', sans-serif",
                  cursor: savingTiming ? 'not-allowed' : 'pointer',
                }}
              >
                {savingTiming ? 'Lagrer…' : 'Lagre'}
              </button>
              {timingSaved && (
                <span style={{ fontSize: 13, color: '#4ade80' }}>Innstilling lagret</span>
              )}
              {timingError && (
                <span style={{ fontSize: 13, color: '#f87171', lineHeight: 1.5 }}>{timingError}</span>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              QUIZ-TIDSPUNKTER — org-spesifikke åpne/lukk-tider
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel title="Quiz-tidspunkter" />

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '24px 22px', marginBottom: 8 }}>
            <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 20 }}>
              Sett egne tidspunkter for når quizen åpner og stenger for din bedrift. La feltene stå tomme for å bruke standard tidspunkter.
            </p>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7873', display: 'block', marginBottom: 8 }}>
                  Quiz åpner
                </label>
                <input
                  type="time"
                  value={orgQuizOpensAt}
                  onChange={e => setOrgQuizOpensAt(e.target.value)}
                  className="oa-input"
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7873', display: 'block', marginBottom: 8 }}>
                  Quiz stenger
                </label>
                <input
                  type="time"
                  value={orgQuizClosesAt}
                  onChange={e => setOrgQuizClosesAt(e.target.value)}
                  className="oa-input"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={saveQuizTimes}
                disabled={savingQuizTimes}
                style={{
                  padding: '9px 22px', background: 'transparent',
                  border: '1px solid #e8e4dd', borderRadius: 10,
                  fontSize: 13, fontWeight: 600, color: '#e8e4dd',
                  fontFamily: "'Instrument Sans', sans-serif",
                  cursor: savingQuizTimes ? 'not-allowed' : 'pointer',
                  opacity: savingQuizTimes ? 0.6 : 1,
                }}
              >
                {savingQuizTimes ? 'Lagrer…' : 'Lagre'}
              </button>
              {quizTimesSaved && (
                <span style={{ fontSize: 13, color: '#4ade80' }}>Tidspunkter lagret</span>
              )}
              {quizTimesError && (
                <span style={{ fontSize: 13, color: '#f87171' }}>{quizTimesError}</span>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              7. DANGER ZONE
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel title="Danger zone" />

          <div style={{
            background: 'rgba(201,76,76,0.04)', border: '1px solid rgba(201,76,76,0.15)',
            borderRadius: 14, padding: '20px 22px',
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
                Nullstill sesong-data
              </p>
              <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.5 }}>
                Sletter alle sesong-poeng for {data?.org.name}. Handlingen kan ikke angres.
              </p>
              {seasonResetDone && (
                <p style={{ fontSize: 12, color: '#4ade80', marginTop: 6 }}>Sesong-data nullstilt.</p>
              )}
            </div>
            <button
              onClick={() => { setSeasonResetModal(true); setSeasonResetInput(''); setSeasonResetError(null) }}
              style={{
                padding: '9px 18px', background: 'transparent',
                border: '1px solid rgba(248,113,113,0.4)',
                borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#f87171',
                fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer',
                transition: 'background 0.15s', flexShrink: 0, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              Nullstill sesong
            </button>
          </div>

          {/* Avslutt bedriftskonto — selvsletting av org */}
          <div style={{
            background: 'rgba(201,76,76,0.04)', border: '1px solid rgba(201,76,76,0.3)',
            borderRadius: 14, padding: '20px 22px', marginTop: 14,
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
                Avslutt bedriftskonto
              </p>
              <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.5 }}>
                Dette avslutter abonnementet og fjerner bedriftens konto fra Quizkanonen.
                Alle ansattes personlige kontoer og quizhistorikk beholdes — de fortsetter
                som vanlige brukere.
              </p>
            </div>
            <button
              onClick={() => { setDeleteOrgModal(true); setDeleteOrgInput(''); setDeleteOrgError(null) }}
              style={{
                padding: '9px 18px', background: 'transparent',
                border: '1px solid rgba(248,113,113,0.4)',
                borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#f87171',
                fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer',
                transition: 'background 0.15s', flexShrink: 0, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              Avslutt bedriftskonto
            </button>
          </div>

          {/* Forlat organisasjon — for admin-en selv, ikke for bedriften */}
          <div style={{
            background: 'rgba(201,76,76,0.04)', border: '1px solid rgba(201,76,76,0.15)',
            borderRadius: 14, padding: '20px 22px', marginTop: 14,
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
                Forlat organisasjon
              </p>
              <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.5 }}>
                Melder deg selv ut av {data?.org.name}. Bedriften består — kontoen din,
                quizhistorikken og poengene dine beholdes.
                {isLastAdmin && ' Du er eneste administrator, så du må utpeke en ny først.'}
              </p>
            </div>
            <button
              onClick={() => setLeaveOrgModal(true)}
              style={{
                padding: '9px 18px', background: 'transparent',
                border: '1px solid rgba(248,113,113,0.4)',
                borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#f87171',
                fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer',
                transition: 'background 0.15s', flexShrink: 0, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              Forlat organisasjon
            </button>
          </div>

        </div>
      </div>

      {/* ── Planlegg-fjerning-modal ────────────────────────────────────────── */}
      {scheduleTarget && data && session && (
        <ScheduleRemovalModal
          membershipId={scheduleTarget.id}
          memberName={scheduleTarget.nickname?.trim() || scheduleTarget.display_name}
          orgName={data.org.name}
          accessToken={session.access_token}
          currentDate={scheduleTarget.scheduled_removal_at ?? null}
          onClose={() => setScheduleTarget(null)}
          onSaved={() => { setScheduleTarget(null); setPlanError(null); loadData(session) }}
        />
      )}

      {/* ── Fjern-medlem-modal ─────────────────────────────────────────────
          Erstatter window.confirm(), som var den eneste nettleser-dialogen
          igjen i panelet — resten av de destruktive handlingene bekreftes i
          egne modaler i designsystemet. */}
      {removeTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px', maxWidth: 420, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>
              Fjern medlem
            </p>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20 }}>
              Dette fjerner <strong style={{ color: '#ffffff' }}>{removeTarget.name}</strong> fra {data?.org.name}.
              Handlingen kan ikke angres. Personens egen konto og quizhistorikk beholdes.
            </p>
            {removeMemberError && (
              <p style={{ fontSize: 12, color: '#f87171', marginBottom: 16, lineHeight: 1.5 }}>{removeMemberError}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setRemoveTarget(null); setRemoveMemberError(null) }}
                disabled={removingId === removeTarget.id}
                style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 8, padding: '8px 16px', cursor: removingId === removeTarget.id ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Avbryt
              </button>
              <button
                onClick={removeMember}
                disabled={removingId === removeTarget.id}
                style={{ fontSize: 13, fontWeight: 600, color: '#1a1c23', background: '#f87171', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: removingId === removeTarget.id ? 'not-allowed' : 'pointer', opacity: removingId === removeTarget.id ? 0.6 : 1, fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {removingId === removeTarget.id ? 'Fjerner…' : 'Fjern medlem'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Forlat-organisasjon-modal ──────────────────────────────────────── */}
      {leaveOrgModal && data && session && (
        <LeaveOrgModal
          orgName={data.org.name}
          orgSlug={slug}
          accessToken={session.access_token}
          isLastAdmin={isLastAdmin}
          onClose={() => setLeaveOrgModal(false)}
        />
      )}

      {/* ── Season-reset modal ─────────────────────────────────────────────── */}
      {seasonResetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px', maxWidth: 420, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>
              Nullstill sesong-data
            </p>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20 }}>
              Dette sletter alle sesong-poeng for {data?.org.name}. Handlingen kan ikke angres.
            </p>
            <p style={{ fontSize: 12, color: '#7a7873', marginBottom: 8 }}>
              Skriv <strong style={{ color: '#e8e4dd' }}>NULLSTILL</strong> for å bekrefte:
            </p>
            <input
              type="text"
              value={seasonResetInput}
              onChange={e => setSeasonResetInput(e.target.value)}
              placeholder="NULLSTILL"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSeasonReset() }}
              style={{ width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none', marginBottom: 16, boxSizing: 'border-box' }}
            />
            {seasonResetError && (
              <p style={{ fontSize: 12, color: '#f87171', marginBottom: 16, lineHeight: 1.5 }}>{seasonResetError}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setSeasonResetModal(false); setSeasonResetInput(''); setSeasonResetError(null) }}
                style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Avbryt
              </button>
              <button
                onClick={handleSeasonReset}
                disabled={seasonResetInput !== 'NULLSTILL' || seasonResetting}
                style={{ fontSize: 13, fontWeight: 600, color: seasonResetInput === 'NULLSTILL' ? '#1a1c23' : '#7a7873', background: seasonResetInput === 'NULLSTILL' ? '#f87171' : '#2a2d38', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: seasonResetInput === 'NULLSTILL' ? 'pointer' : 'not-allowed', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {seasonResetting ? 'Nullstiller…' : 'Nullstill'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Avslutt-bedriftskonto-modal ────────────────────────────────────── */}
      {deleteOrgModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px', maxWidth: 420, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>
              Avslutt bedriftskonto
            </p>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 16 }}>
              Dette avslutter abonnementet og fjerner {data?.org.name} fra Quizkanonen.
              Handlingen kan ikke angres. Ansattes personlige kontoer og quizhistorikk beholdes.
            </p>
            <p style={{ fontSize: 12, color: '#7a7873', marginBottom: 8 }}>
              Skriv bedriftens navn — <strong style={{ color: '#e8e4dd' }}>{data?.org.name}</strong> — for å bekrefte:
            </p>
            <input
              type="text"
              value={deleteOrgInput}
              onChange={e => setDeleteOrgInput(e.target.value)}
              placeholder={data?.org.name}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleDeleteOrg() }}
              style={{ width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none', marginBottom: 16, boxSizing: 'border-box' }}
            />
            {deleteOrgError && (
              <p style={{ fontSize: 12, color: '#f87171', marginBottom: 16 }}>{deleteOrgError}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setDeleteOrgModal(false); setDeleteOrgInput(''); setDeleteOrgError(null) }}
                style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Avbryt
              </button>
              <button
                onClick={handleDeleteOrg}
                disabled={deleteOrgInput.trim() !== data?.org.name || deletingOrg}
                style={{ fontSize: 13, fontWeight: 600, color: deleteOrgInput.trim() === data?.org.name ? '#1a1c23' : '#7a7873', background: deleteOrgInput.trim() === data?.org.name ? '#f87171' : '#2a2d38', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: deleteOrgInput.trim() === data?.org.name ? 'pointer' : 'not-allowed', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {deletingOrg ? 'Avslutter…' : 'Avslutt konto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
