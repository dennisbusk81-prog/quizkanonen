'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { PlayerStats } from '@/lib/history'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' },
  page:     { maxWidth: 600, margin: '0 auto', padding: '0 20px 80px' },
  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },

  avatarSection: { paddingTop: 36, paddingBottom: 28, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', textAlign: 'center' as const },
  avatar:        { width: 80, height: 80, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '2px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Libre Baskerville', serif", fontSize: 30, fontWeight: 700, color: '#c9a84c', marginBottom: 16 },
  displayName:   { fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', marginBottom: 8 },
  badgePremium:  { display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.31)', borderRadius: 6, padding: '3px 10px' },
  badgeStandard: { display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#7a7873', background: 'rgba(122,120,115,0.08)', border: '1px solid rgba(122,120,115,0.2)', borderRadius: 6, padding: '3px 10px' },
  rule:          { width: '100%', height: 1, background: '#2a2d38', marginBottom: 28 },

  card:          { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px' },
  cardDivider:   { height: 1, background: '#2a2d38', margin: '24px 0' },
  sectionLabel:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 6 },
  fieldHint:     { fontSize: 12, color: '#7a7873', marginBottom: 14, lineHeight: 1.5 },
  inputRow:      { display: 'flex', gap: 8 },
  input:         { flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', fontSize: 15, color: '#ffffff', fontFamily: "'Instrument Sans', sans-serif", outline: 'none' },
  saveBtn:       { padding: '10px 22px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const },
  saveBtnDis:    { padding: '10px 22px', background: '#2a2d38', color: '#4a4d5a', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'not-allowed', whiteSpace: 'nowrap' as const },
  saveError:     { fontSize: 12, color: '#f87171', marginTop: 8 },
  saveSuccess:   { fontSize: 12, color: '#4ade80', marginTop: 8 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },

  statsGrid:  { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 },
  statsCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '16px', textAlign: 'center' as const },
  statsNum:   { fontFamily: "'Libre Baskerville', serif", fontSize: 26, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 6 },
  statsLbl:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#7a7873', lineHeight: 1.3 },

  btnGold:        { display: 'inline-block', background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 10, textDecoration: 'none' },
  btnOutlineGold: { display: 'inline-block', background: 'transparent', color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, fontWeight: 600, padding: '9px 20px', borderRadius: 10, textDecoration: 'none', border: '0.5px solid rgba(201,168,76,0.4)' },
  redeemBtn:      { padding: '9px 14px', background: 'transparent', color: '#e8e4dd', border: '0.5px solid #4a4d5a', borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const },
  redeemBtnDis:   { padding: '9px 14px', background: 'transparent', color: '#4a4d5a', border: '0.5px solid #2a2d38', borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif", cursor: 'not-allowed', whiteSpace: 'nowrap' as const },

  ctaCard:  { background: 'rgba(201,168,76,0.04)', border: '0.5px solid rgba(201,168,76,0.15)', borderRadius: 16, padding: '24px 28px' },
  ctaTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#ffffff', marginBottom: 6 },
  ctaSub:   { fontSize: 13, color: '#7a7873', marginBottom: 16, lineHeight: 1.6 },
} as const

function formatMemberNumber(n: number): string {
  return '#' + String(n).padStart(3, '0')
}

type LoadState = 'loading' | 'ready' | 'error'

export default function ProfilPage() {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [editName, setEditName] = useState('')
  const [isPremium, setIsPremium] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [memberNumber, setMemberNumber] = useState<number | null>(null)
  const [memberSince, setMemberSince] = useState<string | null>(null)
  const [showMemberNumber, setShowMemberNumber] = useState(false)
  const [emailReminders, setEmailReminders] = useState(false)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeSuccess, setCodeSuccess] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let loaded = false

    async function loadProfile(uid: string, accessToken: string) {
      if (loaded || cancelled) return
      loaded = true
      setUserId(uid)

      const profileRes = await Promise.race([
        supabase
          .from('profiles')
          .select('display_name, premium_status, member_number, show_member_number, email_reminders, created_at, avatar_url')
          .eq('id', uid)
          .maybeSingle(),
        new Promise<{ data: null; error: Error }>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        ),
      ]).catch(() => ({ data: null, error: null }))

      if (cancelled) return

      const profile = (profileRes as { data: unknown }).data as {
        display_name: string | null; premium_status: boolean | null;
        member_number: number | null; show_member_number: boolean | null;
        email_reminders: boolean | null; created_at: string | null; avatar_url: string | null;
      } | null

      const name = profile?.display_name ?? ''
      setDisplayName(name)
      setEditName(name)
      const premium = profile?.premium_status === true
      setIsPremium(premium)
      setAvatarUrl(profile?.avatar_url ?? null)
      setMemberNumber(profile?.member_number ?? null)
      setShowMemberNumber(profile?.show_member_number ?? false)
      setEmailReminders(profile?.email_reminders ?? false)
      if (profile?.created_at) {
        const d = new Date(profile.created_at)
        const day = d.getDate()
        const month = d.toLocaleDateString('no-NO', { month: 'long' })
        const year = d.getFullYear()
        setMemberSince(`${day}. ${month} ${year}`)
      }

      if (premium) {
        try {
          const res = await fetch('/api/historikk', {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          if (!cancelled && res.ok) {
            const json = await res.json()
            setStats(json.stats ?? null)
          }
        } catch { /* stats are optional */ }
      }

      if (!cancelled) setLoadState('ready')
    }

    // Primary: getSession() direkte — omgår lock hvis session er cachet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session?.user) return
      loadProfile(session.user.id, session.access_token).catch(
        () => { if (!cancelled) setLoadState('error') }
      )
    })

    // Backup: onAuthStateChange fangar opp innlogging og tilfeller
    // der INITIAL_SESSION fyrer men getSession() henger
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') { router.replace('/'); return }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        loadProfile(session.user.id, session.access_token).catch(
          () => { if (!cancelled) setLoadState('error') }
        )
      }
    })

    // Siste utvei: redirect etter 8s hvis ingenting har lastet
    const giveUp = setTimeout(() => {
      if (!loaded && !cancelled) router.replace('/')
    }, 8000)

    // Lytt på automatisk navn-fix fra AuthListener
    function onProfileUpdated(e: Event) {
      const name = (e as CustomEvent<{ display_name: string }>).detail?.display_name
      if (name) { setDisplayName(name); setEditName(name) }
    }
    window.addEventListener('qk:profile-updated', onProfileUpdated)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      clearTimeout(giveUp)
      window.removeEventListener('qk:profile-updated', onProfileUpdated)
    }
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

  async function handleToggleEmailReminders() {
    if (!userId) return
    const next = !emailReminders
    setEmailReminders(next)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/profile/upsert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id: userId, display_name: displayName, email_reminders: next }),
      })
    } catch { /* silent — optimistic update already applied */ }
  }

  async function handleRedeemCode() {
    if (!codeInput.trim() || codeLoading) return
    setCodeLoading(true)
    setCodeSuccess(null)
    setCodeError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/codes/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ code: codeInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCodeError(data.error ?? 'Noe gikk galt. Prøv igjen.')
        setTimeout(() => setCodeError(null), 3000)
      } else {
        setCodeSuccess('Kode aktivert! Du har nå Premium.')
        setCodeInput('')
        setIsPremium(true)
        setTimeout(() => setCodeSuccess(null), 3000)
      }
    } catch {
      setCodeError('Noe gikk galt. Prøv igjen.')
      setTimeout(() => setCodeError(null), 3000)
    } finally {
      setCodeLoading(false)
    }
  }

  async function handleDeleteAccount() {
    if (!confirm('Er du sikker? Dette kan ikke angres.')) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/profile/delete', {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      if (!res.ok) {
        const d = await res.json()
        setDeleteError(d.error ?? 'Noe gikk galt. Prøv igjen.')
        setDeleting(false)
        return
      }
      await supabase.auth.signOut()
      router.replace('/')
    } catch {
      setDeleteError('Noe gikk galt. Prøv igjen.')
      setDeleting(false)
    }
  }

  async function handleToggleShowMember() {
    if (!userId) return
    const next = !showMemberNumber
    setShowMemberNumber(next)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/profile/upsert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id: userId, display_name: displayName, show_member_number: next }),
      })
    } catch { /* silent — optimistic update already applied */ }
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
  const NAME_RE = /^[\p{L}\s\-']{2,40}$/u
  const nameValid = NAME_RE.test(editName.trim())
  const nameChanged = editName.trim() !== displayName
  const saveBtnDisabled = saving || !nameChanged || !nameValid

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
            {avatarUrl ? (
              <img src={avatarUrl} alt="" width={80} height={80} style={{ borderRadius: '50%', objectFit: 'cover', width: 80, height: 80, border: '2px solid #2a2d38', marginBottom: 16, display: 'block' }} />
            ) : (
              <div style={s.avatar}>{initial}</div>
            )}
            <div style={s.displayName}>{displayName}</div>
            {isPremium
              ? <span style={s.badgePremium}>Premium</span>
              : <span style={s.badgeStandard}>Gratis</span>
            }
            {memberNumber !== null && (
              <p style={{ fontSize: 12, color: '#7a7873', marginTop: 8 }}>
                {formatMemberNumber(memberNumber)}{memberSince ? ` · Medlem siden ${memberSince}` : ''}
              </p>
            )}
          </div>

          <div style={s.rule} />

          {/* Innstillinger-kort */}
          <div style={{ ...s.card, marginBottom: 16 }}>

            {/* Visningsnavn */}
            <p style={s.sectionLabel}>Visningsnavn</p>
            <p style={s.fieldHint}>Dette er navnet andre ser på leaderboard og toppliste</p>
            <div style={s.inputRow}>
              <input
                type="text"
                value={editName}
                onChange={e => { setEditName(e.target.value); setSaveError(null); setSaveSuccess(false) }}
                onKeyDown={e => { if (e.key === 'Enter' && !saveBtnDisabled) handleSave() }}
                placeholder="Fornavn Etternavn"
                maxLength={40}
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
            {editName.trim().length > 0 && !nameValid && (
              <p style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>
                Kun bokstaver, mellomrom, bindestrek og apostrof (2–40 tegn)
              </p>
            )}
            {saveError && <p style={s.saveError}>{saveError}</p>}
            {saveSuccess && <p style={s.saveSuccess}>Visningsnavn oppdatert!</p>}

            {memberNumber !== null && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showMemberNumber}
                  onChange={handleToggleShowMember}
                  style={{ width: 16, height: 16, accentColor: '#c9a84c', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 13, color: '#e8e4dd' }}>
                  Vis medlemsnummer på leaderboard og profil
                </span>
              </label>
            )}

            {/* Divider */}
            <div style={s.cardDivider} />

            {/* Påminnelser */}
            <p style={s.sectionLabel}>Påminnelser</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.4 }}>
                Send meg e-post når quizen åpner
              </span>
              {/* Toggle switch */}
              <div
                role="switch"
                aria-checked={emailReminders}
                onClick={handleToggleEmailReminders}
                style={{
                  width: 42, height: 24, borderRadius: 12,
                  background: emailReminders ? '#c9a84c' : '#2a2d38',
                  position: 'relative', cursor: 'pointer', flexShrink: 0,
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute', top: 4,
                  left: emailReminders ? 22 : 4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: emailReminders ? '#1a1c23' : '#7a7873',
                  transition: 'left 0.15s',
                }} />
              </div>
            </div>
            <p style={{ fontSize: 12, color: '#7a7873', marginTop: 8 }}>
              Du får e-post fredag morgen når ukens quiz er klar
            </p>
          </div>

          {/* Verdikode */}
          <div style={{ ...s.card, marginBottom: 16 }}>
            <p style={s.sectionLabel}>Verdikode</p>
            <div style={s.inputRow}>
              <input
                type="text"
                value={codeInput}
                onChange={e => { setCodeInput(e.target.value.toUpperCase()); setCodeError(null); setCodeSuccess(null) }}
                onKeyDown={e => { if (e.key === 'Enter' && !codeLoading && codeInput.trim()) handleRedeemCode() }}
                placeholder="Skriv inn kode…"
                maxLength={60}
                style={{ ...s.input, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#c9a84c' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
              />
              <button
                onClick={handleRedeemCode}
                disabled={codeLoading || !codeInput.trim()}
                style={codeLoading || !codeInput.trim() ? s.redeemBtnDis : s.redeemBtn}
              >
                {codeLoading ? 'Løser inn…' : 'Løs inn →'}
              </button>
            </div>
            {codeSuccess && <p style={{ fontSize: 12, color: '#4ade80', marginTop: 8 }}>{codeSuccess}</p>}
            {codeError && <p style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>{codeError}</p>}
          </div>

          {/* Stats eller abonnement-CTA */}
          {isPremium ? (
            <>
              {stats && stats.total_attempts > 0 && (
                <>
                  <div style={{ ...s.sectionHeader, marginTop: 8 }}>
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
              <div style={s.ctaTitle}>Historikk og statistikk</div>
              <p style={s.ctaSub}>
                Oppgrader til Premium for å se alle quizene du har spilt og score-utvikling uke for uke.
              </p>
              <Link href="/premium" style={s.btnOutlineGold}>Oppgrader til Premium</Link>
            </div>
          )}

          {/* Slett konto */}
          <div style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid #2a2d38', textAlign: 'center' }}>
            {deleteError && (
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#f87171' }}>{deleteError}</p>
            )}
            <button
              onClick={handleDeleteAccount}
              disabled={deleting}
              style={{
                background: 'none', border: 'none', padding: 0,
                fontSize: 12, color: '#7a7873',
                cursor: deleting ? 'not-allowed' : 'pointer',
                fontFamily: "'Instrument Sans', sans-serif",
                textDecoration: 'underline', textDecorationColor: '#4a4d5a',
              }}
            >
              {deleting ? 'Sletter…' : 'Slett konto'}
            </button>
          </div>

        </div>
      </div>
    </>
  )
}
