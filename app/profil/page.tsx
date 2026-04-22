'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { PlayerStats } from '@/lib/history'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' },
  page:     { maxWidth: 680, margin: '0 auto', padding: '0 20px 80px' },
  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },

  avatarSection: { paddingTop: 12, paddingBottom: 10, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', textAlign: 'center' as const },
  avatar:        { width: 72, height: 72, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Libre Baskerville', serif", fontSize: 26, fontWeight: 700, color: '#ffffff', marginBottom: 8 },
  displayName:   { fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', marginBottom: 2 },
  badgePremium:  { display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.31)', borderRadius: 6, padding: '3px 10px', marginBottom: 2 },
  badgeStandard: { display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#7a7873', background: 'rgba(122,120,115,0.08)', border: '1px solid rgba(122,120,115,0.2)', borderRadius: 6, padding: '3px 10px', marginBottom: 2 },
  rule:          { width: '100%', height: 1, background: '#2a2d38', marginBottom: 12 },

  card:          { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px' },
  cardDivider:   { height: 1, background: '#2a2d38', margin: '16px 0' },
  sectionLabel:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 6 },
  fieldHint:     { fontSize: 12, color: '#7a7873', marginBottom: 12, lineHeight: 1.5 },
  inputRow:      { display: 'flex', gap: 8 },
  input:         { flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '10px 14px', fontSize: 15, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none' },
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
  btnOutlineGold: { display: 'inline-block', background: 'transparent', color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, fontWeight: 600, padding: '9px 20px', borderRadius: 10, textDecoration: 'none', border: '1px solid #c9a84c' },
  redeemInput:    { flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  redeemBtn:      { padding: '10px 12px', background: 'transparent', color: '#e8e4dd', border: 'none', fontSize: 13, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const },
  redeemBtnDis:   { padding: '10px 12px', background: 'transparent', color: '#4a4d5a', border: 'none', fontSize: 13, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif", cursor: 'not-allowed', whiteSpace: 'nowrap' as const },

  ctaCard:  { background: 'rgba(201,168,76,0.04)', border: '0.5px solid rgba(201,168,76,0.15)', borderRadius: 16, padding: '24px 28px' },
  ctaTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#ffffff', marginBottom: 6 },
  ctaSub:   { fontSize: 13, color: '#7a7873', marginBottom: 16, lineHeight: 1.6 },
} as const

function formatMemberNumber(n: number): string {
  return '#' + String(n).padStart(3, '0')
}

type LoadState = 'loading' | 'ready' | 'error'
type OrgEntry = { orgId: string; orgName: string; orgSlug: string; isAdmin: boolean }

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
  const [orgs, setOrgs] = useState<OrgEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeSuccess, setCodeSuccess] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Rask mount-henting — fyrer umiddelbart uavhengig av auth events
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, email_reminders, premium_status')
        .eq('id', session.user.id)
        .single()
      if (profile) {
        setDisplayName(profile.display_name ?? '')
        setEditName(profile.display_name ?? '')
        setEmailReminders(profile.email_reminders ?? false)
        setIsPremium(profile.premium_status === true)
      }
    })
  }, [])

  // Hent org-tilknytning via onAuthStateChange (samme mønster som OrgCard)
  useEffect(() => {
    let cancelled = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return
      if (!session?.access_token || cancelled) return
      fetch('/api/org/my-orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: session.access_token }),
      })
        .then(r => r.json())
        .then(d => { if (!cancelled) setOrgs(d.orgs ?? []) })
        .catch(() => {})
    })
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    let cancelled = false
    let loaded = false

    async function loadProfile(uid: string, accessToken: string, avatarUrlFromMeta: string | null) {
      if (loaded || cancelled) return
      loaded = true
      setUserId(uid)

      const profileRes = await Promise.race([
        supabase
          .from('profiles')
          .select('display_name, premium_status, member_number, show_member_number, email_reminders, created_at')
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
        email_reminders: boolean | null; created_at: string | null;
      } | null

      const name = profile?.display_name ?? ''
      setDisplayName(name)
      setEditName(name)
      const premium = profile?.premium_status === true
      setIsPremium(premium)
      setAvatarUrl(avatarUrlFromMeta)
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
      const avatarUrl = (session.user.user_metadata?.avatar_url as string | undefined) ?? null
      loadProfile(session.user.id, session.access_token, avatarUrl).catch(
        () => { if (!cancelled) setLoadState('error') }
      )
    })

    // Backup: onAuthStateChange fangar opp innlogging og tilfeller
    // der INITIAL_SESSION fyrer men getSession() henger
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') { router.replace('/'); return }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        const avatarUrl = (session.user.user_metadata?.avatar_url as string | undefined) ?? null
        loadProfile(session.user.id, session.access_token, avatarUrl).catch(
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

  const initial = displayName?.[0]?.toUpperCase() || '–'
  const NAME_RE = /^[\p{L}\s\-']{2,40}$/u
  const nameValid = NAME_RE.test(editName.trim())
  const nameChanged = editName.trim() !== displayName
  const saveBtnDisabled = saving || !nameChanged || !nameValid

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.wrap}>
        <div style={s.page}>
          <div style={{ paddingTop: 12 }}>
            <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          </div>

          {/* Avatar + identity */}
          <div style={s.avatarSection}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" width={72} height={72} style={{ borderRadius: '50%', objectFit: 'cover', width: 72, height: 72, border: '2px solid #2a2d38', marginBottom: 8, display: 'block' }} />
            ) : (
              <div style={{ ...s.avatar, background: '#4a5568', border: '2px solid #4a5568' }}>{initial}</div>
            )}
            <div style={s.displayName}>{displayName}</div>
            {isPremium
              ? <span style={s.badgePremium}>Premium</span>
              : <span style={s.badgeStandard}>Gratis</span>
            }
            {memberNumber !== null && (
              <p style={{ fontSize: 12, color: '#7a7873', marginTop: 2, marginBottom: 10 }}>
                {formatMemberNumber(memberNumber)}{memberSince ? ` · Medlem siden ${memberSince}` : ''}
              </p>
            )}
          </div>

          {/* 2-kolonne grid: Visningsnavn (venstre) + Din bedrift (høyre) */}
          <div style={isMobile ? {
            display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12,
          } : {
            display: 'grid', gridTemplateColumns: orgs.length > 0 ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 12,
          }}>
            {/* Visningsnavn + Påminnelser */}
            <div style={s.card}>
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

              <div style={s.cardDivider} />

              <p style={s.sectionLabel}>Påminnelser</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.4 }}>
                  Send meg e-post når quizen åpner
                </span>
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

            {/* Din bedrift — kun hvis org-medlem */}
            {orgs.length > 0 && (
              <div style={s.card}>
                <p style={s.sectionLabel}>Din bedrift</p>
                {orgs.map((org, i) => (
                  <div key={org.orgId} style={{ marginTop: i > 0 ? 20 : 0 }}>
                    <p style={{
                      fontFamily: "'Libre Baskerville', serif",
                      fontSize: 16, fontWeight: 700, color: '#ffffff',
                      marginBottom: 10,
                    }}>
                      {org.orgName}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <a href={`/org/${org.orgSlug}`} style={{ fontSize: 14, color: '#e8e4dd', textDecoration: 'none' }}>
                        Se bedriftens toppliste →
                      </a>
                      {org.isAdmin && (
                        <a href={`/org/${org.orgSlug}/admin`} style={{ fontSize: 13, color: '#7a7873', textDecoration: 'none' }}>
                          Administrer →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Statistikk — alltid synlig */}
          <div style={{ ...s.card, marginBottom: 12 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              marginBottom: 16,
            }}>
              {[
                { val: isPremium && stats ? String(stats.total_attempts) : '—', lbl: 'Quizer spilt' },
                { val: isPremium && stats ? `${stats.avg_score_pct}%` : '—', lbl: 'Snitt score' },
                { val: isPremium && stats ? (stats.beste_plassering !== null ? `#${stats.beste_plassering}` : '—') : '—', lbl: 'Beste plassering' },
                { val: isPremium && stats ? String(stats.best_streak) : '—', lbl: 'Beste streak' },
              ].map(({ val, lbl }) => (
                <div key={lbl} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 6 }}>
                    {val}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#7a7873', lineHeight: 1.3 }}>
                    {lbl}
                  </div>
                </div>
              ))}
            </div>
            {isPremium ? (
              <Link href="/historikk" style={s.btnOutlineGold}>Se full historikk →</Link>
            ) : (
              <Link href="/premium" style={s.btnOutlineGold}>Oppgrader til Premium for full historikk →</Link>
            )}
          </div>

          {/* Verdikode */}
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '16px 20px', marginBottom: 12 }}>
            <p style={s.sectionLabel}>Verdikode</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                value={codeInput}
                onChange={e => { setCodeInput(e.target.value.toUpperCase()); setCodeError(null); setCodeSuccess(null) }}
                onKeyDown={e => { if (e.key === 'Enter' && !codeLoading && codeInput.trim()) handleRedeemCode() }}
                placeholder="Skriv inn kode…"
                maxLength={60}
                style={s.redeemInput}
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

          {/* Slett konto */}
          <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #2a2d38', textAlign: 'center' }}>
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
