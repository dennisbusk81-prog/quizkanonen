'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SeasonLeaderboard from '@/components/SeasonLeaderboard'

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

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    let handled = false

    async function loadWithSession(session: import('@supabase/supabase-js').Session) {
      if (handled || cancelled) return
      handled = true

      setAccessToken(session.access_token)

      const listRes = await fetch('/api/leagues', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (cancelled) return
      if (!listRes.ok) { setLoadState('error'); return }

      const listJson = await listRes.json()
      const found = (listJson.leagues ?? []).find((l: LeagueInfo) => l.slug === slug)
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
      const res = await fetch(`/api/leagues/${league.id}/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setResetError(data.error ?? 'Noe gikk galt. Prøv igjen.')
      } else {
        setResetConfirm(false)
      }
    } catch {
      setResetError('Noe gikk galt. Prøv igjen.')
    } finally {
      setResetting(false)
    }
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
              {league?.member_count} {league?.member_count === 1 ? 'medlem' : 'medlemmer'}
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

          {/* Owner: reset */}
          {league?.is_owner && (
            <>
              {resetConfirm ? (
                <div style={s.resetConfirmRow}>
                  <span style={s.resetConfirmText}>Er du sikker? All-time statistikk nullstilles.</span>
                  <button onClick={handleReset} disabled={resetting} style={s.resetConfirmBtn}>
                    {resetting ? 'Nullstiller…' : 'Ja, nullstill'}
                  </button>
                  <button onClick={() => { setResetConfirm(false); setResetError(null) }} style={s.resetCancelBtn}>
                    Avbryt
                  </button>
                </div>
              ) : (
                <div style={s.ownerActions}>
                  <button
                    onClick={() => setResetConfirm(true)}
                    style={s.resetBtn}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(248,113,113,0.4)'; e.currentTarget.style.color = '#f87171' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d38'; e.currentTarget.style.color = '#7a7873' }}
                  >
                    Nullstill all-time
                  </button>
                </div>
              )}
              {resetError && <p style={s.errorMsg}>{resetError}</p>}
            </>
          )}

          {/* Sesong-toppliste — scopet til ligaen */}
          {league && (
            <SeasonLeaderboard scope="league" scopeId={league.id} />
          )}

        </div>
      </div>
    </>
  )
}
