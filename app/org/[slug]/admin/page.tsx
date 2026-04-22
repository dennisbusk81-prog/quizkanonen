'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import type { Session } from '@supabase/supabase-js'

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

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
    admin_can_see_answers: boolean
  }
  members: Member[]
  invites: Invite[]
  currentUserId: string
  stats?: { memberCount: number; activeThisMonth: number }
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '32px 0 16px' }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7a7873', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      <div style={{ flex: 1, height: 1, background: '#2a2d38' }} />
    </div>
  )
}

export default function OrgAdminPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<AdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Winner cards state
  type WinnerEntry = { displayName: string; avatarUrl: string | null; points: number } | null
  const [winners, setWinners] = useState<{ month: WinnerEntry; quarter: WinnerEntry; year: WinnerEntry } | null>(null)

  // Action states
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  // Local settings state
  const [allowGlobal, setAllowGlobal] = useState(false)
  const [adminAnswers, setAdminAnswers] = useState(false)

  // Sesong-administrasjon
  const [seasonOpen, setSeasonOpen]         = useState(false)
  const [seasonResetModal, setSeasonResetModal] = useState(false)
  const [seasonResetInput, setSeasonResetInput] = useState('')
  const [seasonResetting, setSeasonResetting]   = useState(false)
  const [seasonResetDone, setSeasonResetDone]   = useState(false)

  // Admin-håndtering
  const [adminEmail, setAdminEmail]           = useState('')
  const [adminActionLoading, setAdminActionLoading] = useState(false)
  const [adminActionError, setAdminActionError]     = useState<string | null>(null)
  const [adminActionSuccess, setAdminActionSuccess] = useState<string | null>(null)

  // Medlemsoversikt
  type MemberActivity = { userId: string; displayName: string; role: string; hasPlayed: boolean; totalPoints: number; quizCount: number; lastActiveAt: string | null; isExcluded: boolean }
  const [activityPeriod, setActivityPeriod]   = useState<'month' | 'quarter' | 'year'>('month')
  const [activityData, setActivityData]       = useState<MemberActivity[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [excludingId, setExcludingId]         = useState<string | null>(null)

  // Hard timeout — show error state after 8s if session never resolves
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
          setAdminAnswers(d.org.admin_can_see_answers)
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

  // Reload aktivitet ved periodebytte
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
        body: JSON.stringify({ allow_global_league: allowGlobal, admin_can_see_answers: adminAnswers }),
      })
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } finally {
      setSavingSettings(false)
    }
  }

  const handleSetAdmin = async (action: 'add' | 'remove', email: string) => {
    if (!session || !email.trim()) return
    setAdminActionLoading(true)
    setAdminActionError(null)
    setAdminActionSuccess(null)
    try {
      const res = await fetch(`/api/org/${slug}/set-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: email.trim(), action }),
      })
      const json = await res.json()
      if (!res.ok) {
        setAdminActionError(json.error ?? 'Noe gikk galt')
      } else {
        setAdminActionSuccess(action === 'add' ? 'Admin lagt til' : 'Admin-rolle fjernet')
        setAdminEmail('')
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

  if (loading) {
    return (
      <>
        <style>{FONT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' }}>Laster…</p>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <style>{FONT}</style>
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

  const activeInvites = data?.invites.filter(i => i.is_active) ?? []
  const inactiveInvites = data?.invites.filter(i => !i.is_active) ?? []

  return (
    <>
      <style>{FONT + ' * { box-sizing: border-box; }'}</style>
      <UserMenuWrapper />
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 20px 80px' }}>

          <div style={{ paddingTop: 20 }}>
            <Link href={`/org/${slug}`} style={{ fontSize: 12, color: '#7a7873', textDecoration: 'none', letterSpacing: '0.04em' }}>
              ← Leaderboard
            </Link>
          </div>

          {/* Header */}
          <div style={{ padding: '36px 0 8px' }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8 }}>
              {data?.org.name}
            </p>
            <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(24px, 5vw, 32px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
              Admin<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>panel</em>
            </h1>
          </div>

          {/* ── STATS ───────────────────────────────────── */}
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 8 }}>
            {[
              { val: data?.stats?.memberCount ?? data?.members.length ?? '—', lbl: 'Medlemmer totalt' },
              { val: data?.stats?.activeThisMonth ?? '—', lbl: 'Aktive denne måneden' },
            ].map(({ val, lbl }) => (
              <div key={lbl}>
                <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 6 }}>
                  {val}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#7a7873' }}>
                  {lbl}
                </div>
              </div>
            ))}
          </div>

          {/* ── ADMINISTRATORER ─────────────────────────── */}
          <SectionHeader title="Administratorer" />
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px' }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 14 }}>
              Administratorer
            </p>

            {/* Existing admins list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {(data?.members ?? []).filter(m => m.role === 'admin').map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: '#2a2d38', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 13, fontWeight: 700,
                    color: '#e8e4dd', flexShrink: 0,
                  }}>
                    {m.display_name[0]?.toUpperCase() ?? '?'}
                  </div>
                  <span style={{ flex: 1, fontSize: 14, color: '#e8e4dd' }}>{m.display_name}</span>
                  {m.user_id !== data?.currentUserId && (
                    <button
                      disabled={adminActionLoading}
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: '#7a7873', cursor: adminActionLoading ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", textDecoration: 'underline', textDecorationColor: '#4a4d5a' }}
                      onClick={async () => {
                        setAdminActionLoading(true)
                        setAdminActionError(null)
                        setAdminActionSuccess(null)
                        try {
                          const res = await fetch(`/api/org/${slug}/set-admin`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
                            body: JSON.stringify({ userId: m.user_id, action: 'remove' }),
                          })
                          const json = await res.json()
                          if (!res.ok) { setAdminActionError(json.error ?? 'Noe gikk galt') }
                          else { setAdminActionSuccess('Admin-rolle fjernet'); loadData(session!); setTimeout(() => setAdminActionSuccess(null), 3000) }
                        } catch { setAdminActionError('Noe gikk galt') }
                        finally { setAdminActionLoading(false) }
                      }}
                    >
                      Fjern admin
                    </button>
                  )}
                  {m.user_id === data?.currentUserId && (
                    <span style={{ fontSize: 12, color: '#4a4d5a' }}>deg</span>
                  )}
                </div>
              ))}
            </div>

            {/* Add admin by email */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="email"
                value={adminEmail}
                onChange={e => { setAdminEmail(e.target.value); setAdminActionError(null) }}
                onKeyDown={e => { if (e.key === 'Enter' && adminEmail.trim()) handleSetAdmin('add', adminEmail) }}
                placeholder="e-post til nytt admin-medlem…"
                style={{
                  flex: 1, background: '#1a1c23', border: '1px solid #2a2d38',
                  borderRadius: 8, padding: '9px 12px', fontSize: 14,
                  color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#c9a84c' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
              />
              <button
                onClick={() => handleSetAdmin('add', adminEmail)}
                disabled={adminActionLoading || !adminEmail.trim()}
                style={{
                  padding: '9px 16px', background: 'transparent',
                  border: `1px solid ${adminActionLoading || !adminEmail.trim() ? '#2a2d38' : '#c9a84c'}`,
                  borderRadius: 8, fontSize: 13, fontWeight: 600,
                  color: adminActionLoading || !adminEmail.trim() ? '#4a4d5a' : '#c9a84c',
                  cursor: adminActionLoading || !adminEmail.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' as const,
                }}
              >
                {adminActionLoading ? 'Lagrer…' : 'Gjør til admin →'}
              </button>
            </div>
            {adminActionError && <p style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>{adminActionError}</p>}
            {adminActionSuccess && <p style={{ fontSize: 12, color: '#4ade80', marginTop: 8 }}>{adminActionSuccess}</p>}
          </div>

          {/* ── OVERVIEW ────────────────────────────────── */}
          <SectionHeader title="Oversikt" />
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>
            {[
              { label: 'Plan', value: data?.org.plan ?? '—' },
              { label: 'Medlemmer', value: String(data?.members.length ?? 0) },
              { label: 'Aktive invitasjoner', value: String(activeInvites.length) },
              { label: 'Premium utløper', value: data?.org.stripe_period_end ? new Date(data.org.stripe_period_end).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }) : '—' },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 11, color: '#7a7873', marginBottom: 4, letterSpacing: '0.04em' }}>{item.label}</div>
                <div style={{ fontSize: 18, fontFamily: "'Libre Baskerville', serif", fontWeight: 700, color: '#ffffff' }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* ── SESONG-VINNERE ──────────────────────────── */}
          <SectionHeader title="Sesong-vinnere" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 8 }}>
            {([
              { label: 'MÅNEDENS VINNER',  winner: winners?.month },
              { label: 'KVARTALETS VINNER', winner: winners?.quarter },
              { label: 'ÅRETS KANON',       winner: winners?.year },
            ] as { label: string; winner: { displayName: string; avatarUrl: string | null; points: number } | null | undefined }[]).map(({ label, winner }) => (
              <div key={label} style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '18px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', marginBottom: 12 }}>
                  {label}
                </div>
                {winner === undefined ? (
                  <div style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic' }}>Laster…</div>
                ) : winner === null ? (
                  <div style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic' }}>Ingen data ennå</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#c9a84c', flexShrink: 0, overflow: 'hidden' }}>
                        {winner.avatarUrl
                          ? <img src={winner.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" />
                          : (winner.displayName[0]?.toUpperCase() ?? '?')
                        }
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {winner.displayName}
                        </div>
                        <div style={{ fontSize: 12, color: '#c9a84c', fontWeight: 600 }}>{winner.points} poeng</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'right' as const, marginBottom: 8 }}>
            <a href={`/org/${slug}`} style={{ fontSize: 12, color: '#e8e4dd', textDecoration: 'none', letterSpacing: '0.04em' }}>
              Se full toppliste →
            </a>
          </div>

          {/* ── SESONG-ADMINISTRASJON (accordion) ───────── */}
          <div style={{ margin: '32px 0 0' }}>
            <button
              onClick={() => setSeasonOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#21242e', border: '1px solid #3a3d4a', borderRadius: seasonOpen ? '16px 16px 0 0' : 16, padding: '14px 18px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", transition: 'border-color 150ms' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#c9a84c'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#3a3d4a'}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd' }}>Sesong-administrasjon</span>
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transform: seasonOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }}>
                <path d="M1 1L5 5L9 1" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            {seasonOpen && (
              <div style={{ background: '#21242e', border: '1px solid #3a3d4a', borderTop: 'none', borderRadius: '0 0 16px 16px', padding: '18px 20px 20px' }}>
                <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 14 }}>
                  Nullstiller alle sesong-poeng for bedriftens toppliste. Handlingen kan ikke angres.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { setSeasonResetModal(true); setSeasonResetInput('') }}
                    style={{ fontSize: 13, fontWeight: 500, color: '#f87171', background: 'transparent', border: '0.5px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    Nullstill all data
                  </button>
                  {seasonResetDone && (
                    <span style={{ fontSize: 12, color: '#4ade80', background: 'rgba(74,222,128,0.08)', padding: '4px 10px', borderRadius: 6 }}>
                      Sesong-data nullstilt.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── MEDLEMSOVERSIKT ──────────────────────────── */}
          <SectionHeader title="Medlemsoversikt" />

          {/* Period tabs + CSV */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4, background: '#1a1c23', borderRadius: 10, padding: 3 }}>
              {(['month', 'quarter', 'year'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setActivityPeriod(p)}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", background: activityPeriod === p ? '#21242e' : 'transparent', color: activityPeriod === p ? '#c9a84c' : '#e8e4dd', transition: 'background 0.15s, color 0.15s' }}
                >
                  {p === 'month' ? 'Måned' : p === 'quarter' ? 'Kvartal' : 'År'}
                </button>
              ))}
            </div>
            <button
              onClick={downloadCsv}
              style={{ fontSize: 12, fontWeight: 500, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' }}
            >
              Last ned CSV
            </button>
          </div>

          {activityLoading ? (
            <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', marginBottom: 16 }}>Laster…</p>
          ) : activityData && activityData.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              {activityData.map(m => (
                <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 12, marginBottom: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.hasPlayed ? '#4ade80' : '#2a2d38', border: m.hasPlayed ? 'none' : '1px solid #3a3d4a', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: m.isExcluded ? '#7a7873' : '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.displayName}
                      {m.role === 'admin' && <span style={{ fontSize: 10, color: '#c9a84c', fontWeight: 500, marginLeft: 6, letterSpacing: '0.06em' }}>ADMIN</span>}
                      {m.isExcluded && <span style={{ fontSize: 10, color: '#7a7873', marginLeft: 6 }}>(ekskludert)</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#7a7873', marginTop: 1 }}>
                      {m.hasPlayed ? `${m.totalPoints} poeng · ${m.quizCount} quiz${m.quizCount !== 1 ? 'er' : ''}` : 'Ikke spilt ennå'}
                      {m.lastActiveAt && ` · sist aktiv ${new Date(m.lastActiveAt).toLocaleDateString('nb-NO')}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleExclude(m.userId, m.isExcluded)}
                    disabled={excludingId === m.userId}
                    style={{ fontSize: 11, color: m.isExcluded ? '#c9a84c' : '#7a7873', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 6, padding: '4px 10px', cursor: excludingId === m.userId ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    {excludingId === m.userId ? '…' : m.isExcluded ? 'Vis igjen' : 'Ekskluder'}
                  </button>
                </div>
              ))}
            </div>
          ) : activityData !== null ? (
            <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 16 }}>Ingen aktivitetsdata for denne perioden.</p>
          ) : null}

          {/* ── INVITE LINKS ────────────────────────────── */}
          <SectionHeader title="Invitasjonslenker" />

          <button
            onClick={createInvite}
            disabled={creatingInvite}
            style={{ background: 'transparent', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.4)', fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, cursor: creatingInvite ? 'not-allowed' : 'pointer', opacity: creatingInvite ? 0.6 : 1, marginBottom: 14 }}
          >
            {creatingInvite ? 'Oppretter...' : '+ Opprett ny lenke'}
          </button>

          {activeInvites.length === 0 ? (
            <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 8 }}>Ingen aktive invitasjonslenker.</p>
          ) : (
            activeInvites.map(invite => (
              <div key={invite.id} style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 12, padding: '16px 18px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#e8e4dd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    /bli-med/{invite.token.slice(0, 16)}…
                  </div>
                  <div style={{ fontSize: 11, color: '#7a7873', marginTop: 3 }}>
                    Brukt {invite.use_count} gang{invite.use_count !== 1 ? 'er' : ''}{invite.max_uses !== null ? ` av ${invite.max_uses}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => copyLink(invite.token)}
                  style={{ background: 'rgba(201,168,76,0.1)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.25)', fontFamily: "'Instrument Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {copiedToken === invite.token ? 'Kopiert!' : 'Kopier'}
                </button>
                <button
                  onClick={() => deactivateInvite(invite.id)}
                  disabled={deactivatingId === invite.id}
                  style={{ background: 'transparent', color: '#7a7873', border: '1px solid #2a2d38', fontFamily: "'Instrument Sans', sans-serif", fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: deactivatingId === invite.id ? 'not-allowed' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {deactivatingId === invite.id ? '...' : 'Deaktiver'}
                </button>
              </div>
            ))
          )}

          {inactiveInvites.length > 0 && (
            <p style={{ fontSize: 11, color: '#7a7873', marginTop: 8 }}>
              + {inactiveInvites.length} deaktivert{inactiveInvites.length !== 1 ? 'e' : ''} lenke{inactiveInvites.length !== 1 ? 'r' : ''}
            </p>
          )}

          {/* ── MEMBERS ─────────────────────────────────── */}
          <SectionHeader title="Medlemmer" />

          {(data?.members ?? []).map(member => {
            const isMe = member.user_id === data?.currentUserId
            return (
              <div key={member.id} style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 12, padding: '14px 18px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#c9a84c', flexShrink: 0 }}>
                  {(member.display_name[0] ?? '?').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: isMe ? '#c9a84c' : '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {member.display_name}{isMe ? ' (deg)' : ''}
                  </div>
                  <div style={{ fontSize: 11, color: '#7a7873', marginTop: 2 }}>
                    {member.role === 'admin' ? 'Admin' : 'Medlem'} · ble med {new Date(member.joined_at).toLocaleDateString('nb-NO')}
                  </div>
                </div>
                {!isMe && (
                  <button
                    onClick={() => removeMember(member.id)}
                    disabled={removingId === member.id}
                    style={{ background: 'transparent', color: '#7a7873', border: '1px solid #2a2d38', fontFamily: "'Instrument Sans', sans-serif", fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: removingId === member.id ? 'not-allowed' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
                  >
                    {removingId === member.id ? '...' : 'Fjern'}
                  </button>
                )}
              </div>
            )
          })}

          {/* ── SETTINGS ────────────────────────────────── */}
          <SectionHeader title="Innstillinger" />

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px 24px' }}>

            {/* Toggle: allow global league */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer', marginBottom: 20 }}>
              <div
                onClick={() => setAllowGlobal(v => !v)}
                style={{ marginTop: 2, width: 36, height: 20, borderRadius: 10, background: allowGlobal ? '#c9a84c' : '#2a2d38', border: `1px solid ${allowGlobal ? '#c9a84c' : '#3a3d48'}`, position: 'relative', flexShrink: 0, cursor: 'pointer', transition: 'background 0.2s' }}
              >
                <div style={{ position: 'absolute', top: 2, left: allowGlobal ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#ffffff', transition: 'left 0.2s' }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: 3 }}>Delta i global sesong-toppliste</div>
                <div style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.5 }}>Tillat at bedriftens ansatte vises på den globale sesong-topplisten.</div>
              </div>
            </label>

            {/* Toggle: admin can see answers */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer', marginBottom: 24 }}>
              <div
                onClick={() => setAdminAnswers(v => !v)}
                style={{ marginTop: 2, width: 36, height: 20, borderRadius: 10, background: adminAnswers ? '#c9a84c' : '#2a2d38', border: `1px solid ${adminAnswers ? '#c9a84c' : '#3a3d48'}`, position: 'relative', flexShrink: 0, cursor: 'pointer', transition: 'background 0.2s' }}
              >
                <div style={{ position: 'absolute', top: 2, left: adminAnswers ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#ffffff', transition: 'left 0.2s' }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: 3 }}>Admin kan se svar</div>
                <div style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.5 }}>Gi admin-brukere tilgang til å se hva hvert medlem svarte på hvert spørsmål.</div>
              </div>
            </label>

            <button
              onClick={saveSettings}
              disabled={savingSettings}
              style={{ background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 24px', borderRadius: 10, border: 'none', cursor: savingSettings ? 'not-allowed' : 'pointer', opacity: savingSettings ? 0.6 : 1 }}
            >
              {settingsSaved ? 'Lagret!' : savingSettings ? 'Lagrer...' : 'Lagre innstillinger'}
            </button>
          </div>

        </div>
      </div>

      {/* Sesong-reset modal */}
      {seasonResetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px', maxWidth: 420, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>Nullstill sesong-data</p>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20 }}>
              Dette sletter alle sesong-poeng for {data?.org.name}. Handlingen kan ikke angres.
            </p>
            <p style={{ fontSize: 12, color: '#7a7873', marginBottom: 8 }}>Skriv <strong style={{ color: '#e8e4dd' }}>NULLSTILL</strong> for å bekrefte:</p>
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
