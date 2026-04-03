'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { PlayerStats } from '@/lib/history'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#9a9590' },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 60px' },
  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#6a6860', fontStyle: 'italic' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#6a6860', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },

  avatarSection: { paddingTop: 32, paddingBottom: 24, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', textAlign: 'center' as const },
  avatar:        { width: 72, height: 72, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '2px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#c9a84c', marginBottom: 16 },
  displayName:   { fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', marginBottom: 8 },
  badgePremium:  { display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.31)', borderRadius: 6, padding: '3px 10px' },
  badgeStandard: { display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#6a6860', background: 'transparent', border: '1px solid #2a2d38', borderRadius: 6, padding: '3px 10px' },
  rule:          { width: '100%', height: 1, background: '#2a2d38', marginBottom: 24 },

  card:          { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '24px 24px' },
  sectionLabel:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#6a6860', marginBottom: 12 },
  inputRow:      { display: 'flex', gap: 8 },
  input:         { flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', fontSize: 15, color: '#ffffff', fontFamily: "'Instrument Sans', sans-serif", outline: 'none' },
  saveBtn:       { padding: '10px 20px', background: '#c9a84c', color: '#0f0f10', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  saveBtnDis:    { padding: '10px 20px', background: '#3a3d4a', color: '#6a6860', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'not-allowed' },
  saveError:     { fontSize: 12, color: '#f87171', marginTop: 8 },
  saveSuccess:   { fontSize: 12, color: '#4ade80', marginTop: 8 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },

  statsGrid:  { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 },
  statsCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '16px', textAlign: 'center' as const },
  statsNum:   { fontFamily: "'Libre Baskerville', serif", fontSize: 26, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 6 },
  statsLbl:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#6a6860', lineHeight: 1.3 },

  btnGold:      { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 10, textDecoration: 'none' },

  ctaCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '32px 24px', textAlign: 'center' as const },
  ctaTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 8 },
  ctaSub:   { fontSize: 13, color: '#6a6860', marginBottom: 20, lineHeight: 1.6 },
} as const

type LoadState = 'loading' | 'ready' | 'error'

export default function ProfilPage() {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [editName, setEditName] = useState('')
  const [isPremium, setIsPremium] = useState(false)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      let { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        await new Promise<void>(r => setTimeout(r, 500))
        if (cancelled) return
        const { data } = await supabase.auth.getSession()
        session = data.session
      }
      if (cancelled) return
      if (!session) { router.replace('/'); return }

      const uid = session.user.id
      setUserId(uid)

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, premium_status')
        .eq('id', uid)
        .maybeSingle()

      if (cancelled) return

      const name = profile?.display_name ?? session.user.email?.split('@')[0] ?? ''
      setDisplayName(name)
      setEditName(name)
      const premium = profile?.premium_status === true
      setIsPremium(premium)

      if (premium) {
        try {
          const res = await fetch('/api/historikk', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          if (!cancelled && res.ok) {
            const json = await res.json()
            setStats(json.stats ?? null)
          }
        } catch { /* stats are optional */ }
      }

      if (!cancelled) setLoadState('ready')
    }

    load().catch(() => { if (!cancelled) setLoadState('error') })
    return () => { cancelled = true }
  }, [router])

  async function handleSave() {
    if (!userId || !editName.trim()) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/profile/upsert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id: userId, display_name: editName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error ?? 'Noe gikk galt. Prøv igjen.')
      } else {
        setDisplayName(editName.trim())
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      }
    } catch {
      setSaveError('Noe gikk galt. Prøv igjen.')
    } finally {
      setSaving(false)
    }
  }

  if (loadState === 'loading') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}><p style={s.spinner}>Laster profil…</p></div>
      </>
    )
  }

  if (loadState === 'error') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}><p style={s.spinner}>Noe gikk galt. Prøv igjen.</p></div>
      </>
    )
  }

  const initial = displayName?.[0]?.toUpperCase() ?? '?'
  const nameChanged = editName.trim() !== displayName
  const saveBtnDisabled = saving || !nameChanged || !editName.trim()

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.wrap}>
        <div style={s.page}>
          <div style={{ paddingTop: 20 }}>
            <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          </div>

          {/* Avatar + identity */}
          <div style={s.avatarSection}>
            <div style={s.avatar}>{initial}</div>
            <div style={s.displayName}>{displayName}</div>
            {isPremium
              ? <span style={s.badgePremium}>Premium</span>
              : <span style={s.badgeStandard}>Standardkonto</span>
            }
          </div>

          <div style={s.rule} />

          {/* Edit display name */}
          <div style={{ marginBottom: 24 }}>
            <div style={s.card}>
              <p style={s.sectionLabel}>Brukernavn</p>
              <div style={s.inputRow}>
                <input
                  type="text"
                  value={editName}
                  onChange={e => { setEditName(e.target.value); setSaveError(null); setSaveSuccess(false) }}
                  onKeyDown={e => { if (e.key === 'Enter' && !saveBtnDisabled) handleSave() }}
                  maxLength={50}
                  style={s.input}
                  onFocus={e => { e.currentTarget.style.borderColor = '#c9a84c' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
                />
                <button
                  onClick={handleSave}
                  disabled={saveBtnDisabled}
                  style={saveBtnDisabled ? s.saveBtnDis : s.saveBtn}
                >
                  {saving ? 'Lagrer…' : 'Lagre'}
                </button>
              </div>
              {saveError && <p style={s.saveError}>{saveError}</p>}
              {saveSuccess && <p style={s.saveSuccess}>Brukernavn oppdatert!</p>}
            </div>
          </div>

          {/* Stats or CTA */}
          {isPremium ? (
            <>
              {stats && stats.total_attempts > 0 && (
                <>
                  <div style={s.sectionHeader}>
                    <span style={s.sectionText}>Statistikk</span>
                    <div style={s.sectionLine} />
                  </div>
                  <div style={s.statsGrid}>
                    <div style={s.statsCard}>
                      <div style={s.statsNum}>{stats.total_attempts}</div>
                      <div style={s.statsLbl}>Quizer spilt</div>
                    </div>
                    <div style={s.statsCard}>
                      <div style={s.statsNum}>{stats.avg_score_pct}%</div>
                      <div style={s.statsLbl}>Snitt score</div>
                    </div>
                    <div style={s.statsCard}>
                      <div style={s.statsNum}>
                        {stats.beste_plassering !== null ? `#${stats.beste_plassering}` : '—'}
                      </div>
                      <div style={s.statsLbl}>Beste plassering</div>
                    </div>
                    <div style={s.statsCard}>
                      <div style={s.statsNum}>{stats.best_streak}</div>
                      <div style={s.statsLbl}>Beste streak</div>
                    </div>
                  </div>
                </>
              )}
              <Link href="/historikk" style={s.btnGold}>Se full historikk →</Link>
            </>
          ) : (
            <div style={s.ctaCard}>
              <div style={s.ctaTitle}>Se din historikk og statistikk</div>
              <p style={s.ctaSub}>
                Oppgrader til Premium for å se alle quizene du har spilt,
                din score-utvikling og statistikk.
              </p>
              <Link href="/premium" style={s.btnGold}>Oppgrader til Premium</Link>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
