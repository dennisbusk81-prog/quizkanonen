'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import type { Session } from '@supabase/supabase-js'

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1a1c23; font-family: 'Instrument Sans', sans-serif; color: #e8e4dd; min-height: 100vh; }

  .oa-page { max-width: 720px; margin: 0 auto; padding: 0 20px 80px; }

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
  .oa-rank-silver { color: #a0a8b8; }
  .oa-rank-bronze { color: #c4825a; }

  /* ── Responsive ── */
  @media (max-width: 580px) {
    .oa-stats-strip { flex-wrap: wrap !important; }
    .oa-stat { min-width: calc(50% - 6px) !important; }
    .oa-winners-grid { grid-template-columns: 1fr !important; }
  }
`

// ── Types ─────────────────────────────────────────────────────────────────────

type Member = {
  id: string
  user_id: string
  role: string
  joined_at: string
  display_name: string
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
    allow_global_league: boolean
  }
  members: Member[]
  invites: Invite[]
  currentUserId: string
  stats?: { memberCount: number; activeThisMonth: number }
}

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
      {(name[0] ?? '?').toUpperCase()}
    </div>
  )
}

function Tag({ label, color }: { label: string; color: 'gold' | 'green' | 'blue' | 'muted' }) {
  const map = {
    gold:  { bg: 'rgba(201,168,76,0.12)',  border: 'rgba(201,168,76,0.28)',  text: '#c9a84c' },
    green: { bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.25)',  text: '#4ade80' },
    blue:  { bg: 'rgba(99,179,237,0.10)',  border: 'rgba(99,179,237,0.25)',  text: '#63b3ed' },
    muted: { bg: 'rgba(122,120,115,0.12)', border: 'rgba(122,120,115,0.25)', text: '#7a7873' },
  }
  const c = map[color]
  return (
    <span style={{
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrgAdminPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<AdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  type WinnerEntry = { displayName: string; avatarUrl: string | null; points: number } | null
  const [winners, setWinners] = useState<{ month: WinnerEntry; quarter: WinnerEntry; year: WinnerEntry } | null>(null)

  const [creatingInvite, setCreatingInvite] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const [allowGlobal, setAllowGlobal] = useState(false)

  const [emailInviteOpen, setEmailInviteOpen]     = useState(false)
  const [emailInviteText, setEmailInviteText]     = useState('')
  const [emailInviteSending, setEmailInviteSending] = useState(false)
  const [emailInviteResult, setEmailInviteResult]   = useState<{ sent: number; failed: string[] } | null>(null)
  const [emailInviteError, setEmailInviteError]     = useState<string | null>(null)

  const [seasonResetModal, setSeasonResetModal]   = useState(false)
  const [seasonResetInput, setSeasonResetInput]   = useState('')
  const [seasonResetting, setSeasonResetting]     = useState(false)
  const [seasonResetDone, setSeasonResetDone]     = useState(false)

  const [hoveredMemberId, setHoveredMemberId]     = useState<string | null>(null)
  const [adminActionLoading, setAdminActionLoading] = useState(false)
  const [adminActionError, setAdminActionError]   = useState<string | null>(null)
  const [adminActionSuccess, setAdminActionSuccess] = useState<string | null>(null)

  type MemberActivity = { userId: string; displayName: string; role: string; hasPlayed: boolean; totalPoints: number; quizCount: number; lastActiveAt: string | null; isExcluded: boolean }
  const [activityPeriod, setActivityPeriod] = useState<'month' | 'quarter' | 'year'>('month')
  const [activityData, setActivityData]     = useState<MemberActivity[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [excludingId, setExcludingId]       = useState<string | null>(null)

  // Search
  const [memberSearch, setMemberSearch] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 8000)
    return () => clearTimeout(t)
  }, [])

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
          .then(json => json.entries?.[0] ?? null)
          .catch(() => null)
      )
    ).then(([month, quarter, year]) => {
      const toWinner = (e: { displayName: string; avatarUrl: string | null; points: number } | null) =>
        e ? { displayName: e.displayName, avatarUrl: e.avatarUrl, points: e.points } : null
      setWinners({ month: toWinner(month), quarter: toWinner(quarter), year: toWinner(year) })
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

  const loadData = useCallback((sess: Session) => {
    fetch(`/api/org/${slug}/admin-data`, {
      headers: { Authorization: `Bearer ${sess.access_token}` },
    })
      .then(r => {
        if (r.status === 403) { setError('Ingen admin-tilgang.'); return null }
        if (!r.ok) { setError('Kunne ikke laste data.'); return null }
        return r.json()
      })
      .then((d: AdminData | null) => {
        if (d) {
          setData(d)
          setAllowGlobal(d.org.allow_global_league)
          loadWinners(d.org.id, sess.access_token)
          loadActivity(d.org.id, sess.access_token, 'month')
        }
      })
      .catch(() => setError('Noe gikk galt.'))
      .finally(() => setLoading(false))
  }, [slug, loadWinners, loadActivity])

  useEffect(() => {
    if (session === undefined) return
    if (!session) { router.push(`/login?next=/org/${slug}/admin`); return }
    loadData(session)
  }, [session, slug, router, loadData])

  useEffect(() => {
    if (!data || !session) return
    loadActivity(data.org.id, session.access_token, activityPeriod)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityPeriod])

  const createInvite = async () => {
    if (!session || !data) return
    setCreatingInvite(true)
    try {
      const res = await fetch('/api/org/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ organization_id: data.org.id }),
      })
      if (res.ok) loadData(session)
    } finally {
      setCreatingInvite(false)
    }
  }

  const deactivateInvite = async (id: string) => {
    if (!session) return
    setDeactivatingId(id)
    try {
      await fetch(`/api/org/invites/${id}/deactivate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      loadData(session)
    } finally {
      setDeactivatingId(null)
    }
  }

  // Deactivate old invite and immediately create a new one
  const renewInvite = async (id: string) => {
    if (!session || !data) return
    setDeactivatingId(id)
    setCreatingInvite(true)
    try {
      await fetch(`/api/org/invites/${id}/deactivate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      await fetch('/api/org/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ organization_id: data.org.id }),
      })
      loadData(session)
    } finally {
      setDeactivatingId(null)
      setCreatingInvite(false)
    }
  }

  const removeMember = async (membershipId: string) => {
    if (!session) return
    setRemovingId(membershipId)
    try {
      await fetch(`/api/org/members/${membershipId}/remove`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      loadData(session)
    } finally {
      setRemovingId(null)
    }
  }

  const saveSettings = async () => {
    if (!session) return
    setSavingSettings(true)
    setSettingsSaved(false)
    try {
      await fetch(`/api/org/${slug}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ allow_global_league: allowGlobal }),
      })
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } finally {
      setSavingSettings(false)
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

  const handleSendInvites = async () => {
    if (!session || !data) return
    const activeInvite = data.invites.find(i => i.is_active)
    if (!activeInvite) { setEmailInviteError('Ingen aktiv invitasjonslenke. Opprett én først.'); return }
    const rawEmails = emailInviteText.split(/[\n,]+/).map(e => e.trim()).filter(Boolean)
    if (rawEmails.length === 0) { setEmailInviteError('Ingen e-postadresser oppgitt.'); return }
    const inviteUrl = `${window.location.origin}/bli-med/${activeInvite.token}`
    const senderName = data.members.find(m => m.user_id === data.currentUserId)?.display_name ?? 'En kollega'
    setEmailInviteSending(true)
    setEmailInviteResult(null)
    setEmailInviteError(null)
    try {
      const res = await fetch(`/api/org/${data.org.id}/send-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ emails: rawEmails, inviteUrl, senderName }),
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
    try {
      const res = await fetch(`/api/org/${data.org.id}/reset-season`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        setSeasonResetModal(false)
        setSeasonResetInput('')
        setSeasonResetDone(true)
        setActivityData(null)
        loadWinners(data.org.id, session.access_token)
        setTimeout(() => setSeasonResetDone(false), 4000)
      }
    } finally {
      setSeasonResetting(false)
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

  const downloadCsv = () => {
    if (!data || !session) return
    const url = `/api/org/${data.org.id}/members-activity?period=${activityPeriod}&format=csv`
    fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = `aktivitet-${activityPeriod}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)
      })
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
        <UserMenuWrapper />
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, color: '#ffffff', marginBottom: 10 }}>Ingen tilgang</p>
            <p style={{ fontSize: 14, color: '#7a7873', marginBottom: 24 }}>{error}</p>
            <Link href="/" style={{ fontSize: 13, color: '#c9a84c', textDecoration: 'none' }}>← Forsiden</Link>
          </div>
        </div>
      </>
    )
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
  const planName       = currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)
  const upgradeHint    =
    currentPlan === 'starter'  ? 'Oppgrader til Standard: opptil 25 deltakere + CSV-eksport' :
    currentPlan === 'standard' ? 'Oppgrader til Pro: opptil 50 deltakere + avdelingsligaer'  :
    null
  const renewalDate    = data?.org.stripe_period_end
    ? new Date(data.org.stripe_period_end).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  // Org name split: all but last word plain, last word in gold italic
  const nameWords      = (data?.org.name ?? '').split(' ')
  const nameFront      = nameWords.slice(0, -1).join(' ')
  const nameLast       = nameWords[nameWords.length - 1] ?? ''

  // Activity map keyed by userId for quick lookup
  const activityMap    = new Map((activityData ?? []).map(m => [m.userId, m]))

  // Filtered members for search
  const q = memberSearch.toLowerCase()
  const filteredMembers = (data?.members ?? []).filter(m =>
    !q || m.display_name.toLowerCase().includes(q)
  )

  // Toppliste: activityData sorted by totalPoints desc
  const sortedByPoints = [...(activityData ?? [])].sort((a, b) => b.totalPoints - a.totalPoints)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{CSS}</style>
      <UserMenuWrapper />

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
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                <button
                  onClick={saveSettings}
                  disabled={savingSettings}
                  style={{
                    padding: '8px 18px', background: 'transparent',
                    border: '1px solid #2a2d38', borderRadius: 10,
                    fontSize: 13, fontWeight: 600, color: '#e8e4dd',
                    fontFamily: "'Instrument Sans', sans-serif", cursor: savingSettings ? 'not-allowed' : 'pointer',
                    transition: 'border-color 0.15s', whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#c9a84c' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
                >
                  {settingsSaved ? 'Lagret!' : savingSettings ? 'Lagrer…' : 'Innstillinger'}
                </button>
                {currentPlan !== 'pro' && (
                  <Link
                    href={`/kontakt`}
                    style={{
                      display: 'inline-block', padding: '8px 18px',
                      background: '#c9a84c', borderRadius: 10,
                      fontSize: 13, fontWeight: 700, color: '#1a1c23',
                      fontFamily: "'Instrument Sans', sans-serif", textDecoration: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Oppgrader →
                  </Link>
                )}
              </div>
            </div>

            {/* Toggle row — inside banner, separated by a subtle divider */}
            <div style={{ borderTop: '1px solid rgba(201,168,76,0.15)', marginTop: 14, paddingTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                onClick={() => setAllowGlobal(v => !v)}
                style={{ width: 28, height: 16, borderRadius: 8, background: allowGlobal ? '#c9a84c' : '#2a2d38', border: `1px solid ${allowGlobal ? '#c9a84c' : '#3a3d48'}`, position: 'relative', flexShrink: 0, cursor: 'pointer', transition: 'background 0.2s' }}
              >
                <div style={{ position: 'absolute', top: 2, left: allowGlobal ? 13 : 2, width: 10, height: 10, borderRadius: '50%', background: '#ffffff', transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: 13, color: '#e8e4dd', cursor: 'pointer' }} onClick={() => setAllowGlobal(v => !v)}>
                Delta i global sesong-toppliste
              </span>
              <span style={{ fontSize: 12, color: '#7a7873', marginLeft: 4 }}>
                — Tillat at ansatte vises på felles sesong-toppliste
              </span>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              4. MEDLEMSSEKSJON
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel
            title="Medlemmer"
            right={
              <button
                onClick={downloadCsv}
                style={{ fontSize: 11, fontWeight: 600, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                Last ned CSV
              </button>
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
              <span style={{ fontSize: 12, color: '#7a7873', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {memberCount} deltaker{memberCount !== 1 ? 'e' : ''}
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
                          {member.display_name}
                        </span>
                        {isAdmin && <Tag label="Admin" color="gold" />}
                        {isMe && <Tag label="deg" color="muted" />}
                        {activity?.hasPlayed && <Tag label="Aktiv" color="green" />}
                      </div>
                      <p style={{ fontSize: 11, color: '#7a7873', marginTop: 2 }}>
                        Ble med {new Date(member.joined_at).toLocaleDateString('nb-NO')}
                        {activity && ` · ${activity.totalPoints} poeng`}
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
                        <button
                          onClick={() => removeMember(member.id)}
                          disabled={removingId === member.id}
                          style={{ fontSize: 11, fontWeight: 600, color: '#7a7873', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: removingId === member.id ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
                        >
                          {removingId === member.id ? '…' : 'Fjern'}
                        </button>
                        {activity && (
                          <button
                            onClick={() => handleExclude(member.user_id, activity.isExcluded)}
                            disabled={excludingId === member.user_id}
                            style={{ fontSize: 11, fontWeight: 600, color: activity.isExcluded ? '#c9a84c' : '#7a7873', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: excludingId === member.user_id ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
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
            <div style={{ borderTop: '1px solid #2a2d38', padding: '16px 18px' }}>

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
                    <div style={{ flex: 1 }} />
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
                        color: emailInviteSending || !emailInviteText.trim() ? '#4a4d5a' : '#1a1c23',
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
              5. TOPPLISTE-SEKSJON
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel title="Toppliste denne måneden" />

          {/* Period tabs */}
          <div className="oa-tab-row" style={{ marginBottom: 0 }}>
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

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>

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
          </div>

          <div style={{ textAlign: 'right', marginTop: 10 }}>
            <a href={`/org/${slug}`} style={{ fontSize: 12, color: '#e8e4dd', textDecoration: 'none' }}>
              Se full toppliste →
            </a>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              6. SESONGVINNERE
          ══════════════════════════════════════════════════════════════════ */}
          <SectionLabel title="Sesongvinnere" />

          <div className="oa-winners-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 8 }}>
            {([
              { label: 'Månedens kanon',   icon: '★', winner: winners?.month   },
              { label: 'Kvartalets kanon', icon: '◆', winner: winners?.quarter },
              { label: 'Årets kanon',      icon: '♛', winner: winners?.year    },
            ] as { label: string; icon: string; winner: WinnerEntry | undefined }[]).map(({ label, icon, winner }) => (
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
                    {winner.avatarUrl ? (
                      <img src={winner.avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <Avatar name={winner.displayName} size={36} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {winner.displayName}
                      </p>
                      <p style={{ fontSize: 12, color: '#c9a84c', fontWeight: 600 }}>{winner.points} poeng</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
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
              onClick={() => { setSeasonResetModal(true); setSeasonResetInput('') }}
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

        </div>
      </div>

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
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setSeasonResetModal(false); setSeasonResetInput('') }}
                style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Avbryt
              </button>
              <button
                onClick={handleSeasonReset}
                disabled={seasonResetInput !== 'NULLSTILL' || seasonResetting}
                style={{ fontSize: 13, fontWeight: 600, color: seasonResetInput === 'NULLSTILL' ? '#0f0f10' : '#7a7873', background: seasonResetInput === 'NULLSTILL' ? '#f87171' : '#2a2d38', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: seasonResetInput === 'NULLSTILL' ? 'pointer' : 'not-allowed', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {seasonResetting ? 'Nullstiller…' : 'Nullstill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
