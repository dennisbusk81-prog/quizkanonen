'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SeasonLeaderboard from '@/components/SeasonLeaderboard'
import NavAuth from '@/components/NavAuth'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

// ─── Types ────────────────────────────────────────────────────────────────────

type LeagueInfo = {
  id: string
  name: string
  slug: string
  is_owner: boolean
  member_count: number
  invite_token: string
  reset_at: string | null
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' },
  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },

  hero:        { paddingTop: 24, paddingBottom: 16 },
  heroEyebrow: { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#7a7873', marginBottom: 6 },
  heroTitle:   { fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em', marginBottom: 6 },
  heroBadge:   { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7a7873' },
  rule:        { width: '100%', height: 1, background: '#2a2d38', marginBottom: 16 },

  // Invite box (owner)
  inviteCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '16px 18px', marginBottom: 12 },
  inviteLabel: { fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', marginBottom: 8 },
  inviteRow:   { display: 'flex', gap: 8 },
  inviteInput: { flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#7a7873', fontFamily: "'Instrument Sans', sans-serif", outline: 'none', overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const },
  copyBtn:     { padding: '8px 16px', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', flexShrink: 0 },
  copyBtnDone: { padding: '8px 16px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#4ade80', fontFamily: "'Instrument Sans', sans-serif", cursor: 'default', flexShrink: 0 },

  // Owner actions
  ownerActions:     { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
  resetBtn:         { padding: '8px 16px', background: 'none', border: '1px solid #2a2d38', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#7a7873', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  resetConfirmRow:  { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, marginBottom: 12 },
  resetConfirmText: { fontSize: 13, color: '#f87171', flex: 1 },
  resetConfirmBtn:  { padding: '6px 14px', background: '#f87171', color: '#0f0f10', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  resetCancelBtn:   { padding: '6px 14px', background: 'none', border: '1px solid #2a2d38', borderRadius: 7, fontSize: 13, color: '#7a7873', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },

  errorMsg: { fontSize: 13, color: '#f87171', marginTop: 8 },
} as const

type LoadState = 'loading' | 'ready' | 'error' | 'notfound'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LigaPage() {
  const router   = useRouter()
  const rawParams = useParams()
  const slug     = Array.isArray(rawParams.slug) ? rawParams.slug[0] : (rawParams.slug ?? '')

  const [loadState, setLoadState]   = useState<LoadState>('loading')
  const [league, setLeague]         = useState<LeagueInfo | null>(null)
  const [accessToken, setAccessToken] = useState('')
  const [inviteUrl, setInviteUrl]   = useState('')
  const [copied, setCopied]         = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting]   = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  // Sesong-administrasjon
  const [seasonOpen, setSeasonOpen]     = useState(false)
  const [seasonResetting, setSeasonResetting] = useState(false)
  const [seasonResetInput, setSeasonResetInput] = useState('')
  const [seasonResetModal, setSeasonResetModal] = useState(false)
  const [seasonResetDone, setSeasonResetDone]   = useState(false)

  // Medlemsoversikt
  type MemberActivity = { userId: string; displayName: string; hasPlayed: boolean; totalPoints: number; quizCount: number; lastActiveAt: string | null; isExcluded: boolean }
  const [activityPeriod, setActivityPeriod]     = useState<'month' | 'quarter' | 'year'>('month')
  const [activityData, setActivityData]         = useState<MemberActivity[] | null>(null)
  const [activityLoading, setActivityLoading]   = useState(false)
  const [excludingId, setExcludingId]           = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    let handled = false

    async function loadWithSession(session: import('@supabase/supabase-js').Session) {
      if (handled || cancelled) return
      handled = true

      setAccessToken(session.access_token)

      // Retry opp til 3 ganger for å håndtere kort forsinkelse etter opprettelse
      let found: LeagueInfo | undefined = undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return
        if (attempt > 0) await new Promise<void>(r => setTimeout(r, 700))

        const listRes = await fetch('/api/leagues', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (cancelled) return
        if (!listRes.ok) { setLoadState('error'); return }

        const listJson = await listRes.json()
        found = (listJson.leagues ?? []).find((l: LeagueInfo) => l.slug === slug)
        if (found) break
      }

      if (!found) { setLoadState('notfound'); return }

      setLeague(found)
      setInviteUrl(`${window.location.origin}/liga/bli-med/${found.invite_token}`)
      if (!cancelled) setLoadState('ready')
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (session) loadWithSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN') return
      if (cancelled) return
      if (!session) { if (!handled) router.replace('/'); return }
      loadWithSession(session)
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [slug, router])

  // Last aktivitetsdata når liga og token er klare (kun for eiere)
  useEffect(() => {
    if (!league?.is_owner || !accessToken) return
    loadActivity(activityPeriod, accessToken, league.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id, league?.is_owner, accessToken, activityPeriod])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* ignore */ }
  }

  async function handleReset() {
    if (!league || resetting) return
    setResetting(true)
    setResetError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      // Nullstiller begge systemene: sesong-scores + legacy all-time
      const res = await fetch(`/api/leagues/${league.id}/reset-season`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setResetError(data.error ?? 'Noe gikk galt. Prøv igjen.')
      } else {
        setResetConfirm(false)
        setActivityData(null)
      }
    } catch {
      setResetError('Noe gikk galt. Prøv igjen.')
    } finally {
      setResetting(false)
    }
  }

  async function handleSeasonReset() {
    if (!league || seasonResetting || seasonResetInput !== 'NULLSTILL') return
    setSeasonResetting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(`/api/leagues/${league.id}/reset-season`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        setSeasonResetModal(false)
        setSeasonResetInput('')
        setSeasonResetDone(true)
        setActivityData(null)
        setTimeout(() => setSeasonResetDone(false), 4000)
      }
    } finally {
      setSeasonResetting(false)
    }
  }

  async function loadActivity(period: 'month' | 'quarter' | 'year', token: string, leagueId: string) {
    setActivityLoading(true)
    setActivityData(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/members-activity?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = res.ok ? await res.json() : { members: [] }
      setActivityData(json.members ?? [])
    } catch {
      setActivityData([])
    } finally {
      setActivityLoading(false)
    }
  }

  async function handleExclude(userId: string, currentlyExcluded: boolean) {
    if (!league || !accessToken) return
    setExcludingId(userId)
    try {
      await fetch('/api/admin/exclude-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ scope_type: 'league', scope_id: league.id, user_id: userId, action: currentlyExcluded ? 'unexclude' : 'exclude' }),
      })
      if (league) loadActivity(activityPeriod, accessToken, league.id)
    } finally {
      setExcludingId(null)
    }
  }

  function downloadCsv() {
    if (!league || !accessToken) return
    const url = `/api/leagues/${league.id}/members-activity?period=${activityPeriod}&format=csv`
    const a = document.createElement('a')
    a.href = url
    a.setAttribute('download', `aktivitet-${activityPeriod}.csv`)
    // Fetch med auth og trigger download
    fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob)
        a.href = blobUrl
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)
      })
  }

  if (loadState === 'loading') return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.centered}><p style={s.spinner}>Laster liga…</p></div>
    </>
  )

  if (loadState === 'notfound') return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.centered}>
        <div style={{ textAlign: 'center' }}>
          <p style={s.spinner}>Fant ikke ligaen.</p>
          <Link href="/liga" style={{ display: 'block', marginTop: 16, fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>← Mine ligaer</Link>
        </div>
      </div>
    </>
  )

  if (loadState === 'error') return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.centered}><p style={s.spinner}>Noe gikk galt. Prøv igjen.</p></div>
    </>
  )

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(26,28,35,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid #2a2d38' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 20px', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/" style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 17, fontWeight: 700, color: '#ffffff', textDecoration: 'none' }}>Quiz<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>kanonen</em></a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><NavAuth /></div>
        </div>
      </nav>
      <div style={s.wrap}>
        <div style={s.page}>
          <div style={{ paddingTop: 20 }}>
            <Link href="/liga" style={s.back}>← Mine ligaer</Link>
          </div>

          {/* Hero */}
          <div style={s.hero}>
            <p style={s.heroEyebrow}>Liga</p>
            <h1 style={s.heroTitle}>{league?.name}</h1>
            <span style={s.heroBadge}>
              {league?.member_count} / 10 {league?.member_count === 1 ? 'medlem' : 'medlemmer'}
              {league?.is_owner && <> · <span style={{ color: '#c9a84c', fontWeight: 600 }}>Du er eier</span></>}
            </span>
          </div>

          <div style={s.rule} />

          {/* Owner: invite link */}
          {league?.is_owner && (
            <div style={s.inviteCard}>
              <p style={s.inviteLabel}>Invitasjonslenke</p>
              <div style={s.inviteRow}>
                <input
                  readOnly
                  value={inviteUrl}
                  style={s.inviteInput}
                  onFocus={e => e.currentTarget.select()}
                />
                <button onClick={handleCopy} style={copied ? s.copyBtnDone : s.copyBtn}>
                  {copied ? 'Kopiert!' : 'Kopier'}
                </button>
              </div>
            </div>
          )}

          {/* Owner: sesong-administrasjon (accordion) */}
          {league?.is_owner && (
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => setSeasonOpen(o => !o)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#21242e', border: '1px solid #3a3d4a', borderRadius: seasonOpen ? '16px 16px 0 0' : 16, padding: '14px 18px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", transition: 'border-color 150ms' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#c9a84c'}
                onMouseLeave={e => e.currentTarget.style.borderColor = seasonOpen ? '#3a3d4a' : '#3a3d4a'}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd' }}>Sesong-administrasjon</span>
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transform: seasonOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }}>
                  <path d="M1 1L5 5L9 1" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
              {seasonOpen && (
                <div style={{ background: '#21242e', border: '1px solid #3a3d4a', borderTop: 'none', borderRadius: '0 0 16px 16px', padding: '18px 18px 20px' }}>
                  <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 14 }}>
                    Nullstiller alle sesong-poeng for denne ligaen. Handlingen kan ikke angres.
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
          )}

          {/* Owner: reset all-time (beholdt for bakoverkompatibilitet, skjult — brukes av bekreftelsesdialog) */}
          {resetError && <p style={s.errorMsg}>{resetError}</p>}

          {/* Sesong-toppliste — scopet til ligaen */}
          {league && (
            <SeasonLeaderboard scope="league" scopeId={league.id} loginHref={`/login?next=/liga/${slug}`} />
          )}

          {/* Eier: Medlemsoversikt */}
          {league?.is_owner && (
            <div style={{ marginTop: 24 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px' }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7a7873', whiteSpace: 'nowrap' }}>
                  Medlemsoversikt
                </span>
                <div style={{ flex: 1, height: 1, background: '#2a2d38' }} />
              </div>

              {/* Period tabs + CSV */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['month', 'quarter', 'year'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setActivityPeriod(p)}
                      style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", background: activityPeriod === p ? 'rgba(201,168,76,0.15)' : 'transparent', color: activityPeriod === p ? '#c9a84c' : '#e8e4dd', transition: 'background 0.15s, color 0.15s' }}
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

              {/* Member list */}
              {activityLoading ? (
                <p style={{ fontSize: 13, color: '#7a7873', fontStyle: 'italic', padding: '16px 0' }}>Laster…</p>
              ) : activityData && activityData.length > 0 ? (
                <div>
                  {activityData.map(m => (
                    <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 12, marginBottom: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.hasPlayed ? '#4ade80' : '#2a2d38', border: m.hasPlayed ? 'none' : '1px solid #3a3d4a', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: m.isExcluded ? '#7a7873' : '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.displayName}{m.isExcluded ? ' (ekskludert)' : ''}
                        </div>
                        <div style={{ fontSize: 11, color: '#7a7873', marginTop: 1 }}>
                          {m.hasPlayed ? `${m.totalPoints} poeng · ${m.quizCount} quiz${m.quizCount !== 1 ? 'er' : ''}` : 'Ikke spilt ennå'}
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
                <p style={{ fontSize: 13, color: '#7a7873', padding: '16px 0' }}>Ingen medlemmer ennå.</p>
              ) : null}
            </div>
          )}

        </div>
      </div>

      {/* Sesong-reset modal */}
      {seasonResetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px', maxWidth: 400, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>Nullstill sesong-data</p>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20 }}>
              Dette sletter alle sesong-poeng for ligaen. Handlingen kan ikke angres.
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
              <button onClick={() => { setSeasonResetModal(false); setSeasonResetInput('') }} style={{ ...s.resetCancelBtn, padding: '8px 16px' }}>Avbryt</button>
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
