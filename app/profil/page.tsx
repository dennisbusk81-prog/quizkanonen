'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { PlayerStats } from '@/lib/history'
import SkeletonCard from '@/components/SkeletonCard'
import PasswordInput from '@/components/PasswordInput'
import { getAvatarInitial } from '@/lib/avatar-initial'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' },
  page:     { maxWidth: 680, margin: '0 auto', padding: '0 20px 80px' },
  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },

  avatarSection: { paddingTop: 8, paddingBottom: 6, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', textAlign: 'center' as const },
  avatar:        { width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff', marginBottom: 6 },
  displayName:   { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#ffffff', marginBottom: 2 },
  badgePremium:  { display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.31)', borderRadius: 6, padding: '3px 10px', marginBottom: 2 },
  badgeStandard: { display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#7a7873', background: 'rgba(122,120,115,0.08)', border: '1px solid rgba(122,120,115,0.2)', borderRadius: 6, padding: '3px 10px', marginBottom: 2 },
  rule:          { width: '100%', height: 1, background: '#2a2d38', marginBottom: 12 },

  card:          { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '16px 18px' },
  cardDivider:   { height: 1, background: '#2a2d38', margin: '12px 0' },
  sectionLabel:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 6 },
  fieldHint:     { fontSize: 12, color: '#7a7873', marginBottom: 12, lineHeight: 1.5 },
  inputRow:      { display: 'flex', gap: 8 },
  input:         { flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '10px 14px', fontSize: 15, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none' },
  saveBtn:       { padding: '10px 22px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const },
  saveBtnDis:    { padding: '10px 22px', background: '#2a2d38', color: '#7a7873', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'not-allowed', whiteSpace: 'nowrap' as const },
  saveError:     { fontSize: 12, color: '#f87171', marginTop: 8 },
  saveSuccess:   { fontSize: 12, color: '#4ade80', marginTop: 8 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },

  statsGrid:  { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 },
  statsCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 12, padding: '12px', textAlign: 'center' as const },
  statsNum:   { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 4 },
  statsLbl:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: '#7a7873', lineHeight: 1.3 },

  btnGold:        { display: 'inline-block', background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 10, textDecoration: 'none' },
  btnOutlineGold: { display: 'inline-block', background: 'transparent', color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, fontWeight: 600, padding: '9px 20px', borderRadius: 10, textDecoration: 'none', border: '1px solid #c9a84c' },
  redeemInput:    { flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '8px 12px', fontSize: 14, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  redeemBtn:      { padding: '8px 16px', background: 'transparent', color: '#e8e4dd', border: '1px solid #2a2d38', fontSize: 14, fontWeight: 500, borderRadius: 10, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const },
  redeemBtnDis:   { padding: '8px 16px', background: 'transparent', color: '#7a7873', border: '1px solid #2a2d38', fontSize: 14, fontWeight: 500, borderRadius: 10, fontFamily: "'Instrument Sans', sans-serif", cursor: 'not-allowed', whiteSpace: 'nowrap' as const },

  // Nøytral knapp (hvit outline) — passord-seksjonen skal ikke konkurrere med de
  // gule primærknappene ellers på siden. Samme mønster som Lagre-knappen for kallenavn.
  pwBtn:    { padding: '10px 22px', background: 'transparent', color: '#e8e4dd', border: '1px solid #e8e4dd', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const },
  pwBtnDis: { padding: '10px 22px', background: 'transparent', color: '#7a7873', border: '1px solid #2a2d38', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'not-allowed', whiteSpace: 'nowrap' as const },

  ctaCard:  { background: 'rgba(201,168,76,0.04)', border: '0.5px solid rgba(201,168,76,0.15)', borderRadius: 16, padding: '16px 20px' },
  ctaTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#ffffff', marginBottom: 6 },
  ctaSub:   { fontSize: 13, color: '#7a7873', marginBottom: 16, lineHeight: 1.6 },
} as const

function formatMemberNumber(n: number): string {
  return '#' + String(n).padStart(3, '0')
}

type LoadState = 'loading' | 'ready' | 'error'
type OrgEntry = { orgId: string; orgName: string; orgSlug: string; isAdmin: boolean; allowGlobalLeague: boolean; globalLeagueOptOut: boolean | null }

export default function ProfilPage() {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [editName, setEditName] = useState('')
  const [nickname, setNickname] = useState('')
  const [editNickname, setEditNickname] = useState('')
  const [savingNickname, setSavingNickname] = useState(false)
  const [nicknameError, setNicknameError] = useState<string | null>(null)
  const [nicknameSuccess, setNicknameSuccess] = useState(false)
  const [isPremium, setIsPremium] = useState(false)
  const [hasStripeCustomer, setHasStripeCustomer] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarColor, setAvatarColor] = useState<string | null>(null)
  const [memberNumber, setMemberNumber] = useState<number | null>(null)
  const [memberSince, setMemberSince] = useState<string | null>(null)
  const [showMemberNumber, setShowMemberNumber] = useState(false)
  const [emailReminders, setEmailReminders] = useState(true)
  const [emailReengagement, setEmailReengagement] = useState(true)
  const [emailDuelNotifications, setEmailDuelNotifications] = useState(true)
  const [prefSavedKey, setPrefSavedKey] = useState<string | null>(null)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [orgs, setOrgs] = useState<OrgEntry[]>([])
  const [globalPrefSavedOrg, setGlobalPrefSavedOrg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeSuccess, setCodeSuccess] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [showRedeem, setShowRedeem] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [pushSupported, setPushSupported] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  // Passord-seksjon: hasPassword styrer om vi tilbyr "Sett passord" (e-postbekreftet
  // vei, som på /login) eller "Endre passord" (direkte, siden sesjonen er aktiv her).
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [hasPassword, setHasPassword] = useState(false)
  const [showPwForm, setShowPwForm] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [resetSending, setResetSending] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('PushManager' in window) || !('Notification' in window)) return
    setPushSupported(true)
    if (Notification.permission !== 'granted') return
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => { setPushEnabled(!!sub) })
      .catch(() => {})
  }, [])

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
        .select('display_name, nickname, email_reminders, email_reengagement, email_duel_notifications')
        .eq('id', session.user.id)
        .single()
      if (profile) {
        setDisplayName(profile.display_name ?? '')
        setEditName(profile.display_name ?? '')
        setNickname(profile.nickname ?? '')
        setEditNickname(profile.nickname ?? '')
        setEmailReminders(profile.email_reminders ?? true)
        setEmailReengagement(profile.email_reengagement ?? true)
        setEmailDuelNotifications(profile.email_duel_notifications ?? true)
      }
      // Premium: hent server-side for å omgå RLS
      try {
        const premRes = await fetch('/api/profile/premium-status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (premRes.ok) {
          const premData = await premRes.json()
          setIsPremium(premData.isPremium === true)
          setHasStripeCustomer(premData.hasStripeCustomer === true)
        }
      } catch { /* fallback: not premium */ }
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

    async function loadProfile(uid: string, accessToken: string, avatarUrlFromMeta: string | null, email: string | null) {
      if (loaded || cancelled) return
      loaded = true
      setUserId(uid)
      setUserEmail(email)

      const profileRes = await Promise.race([
        supabase
          .from('profiles')
          .select('display_name, nickname, member_number, show_member_number, email_reminders, email_reengagement, email_duel_notifications, created_at, avatar_color, has_password')
          .eq('id', uid)
          .maybeSingle(),
        new Promise<{ data: null; error: Error }>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        ),
      ]).catch(() => ({ data: null, error: null }))

      if (cancelled) return

      const profile = (profileRes as { data: unknown }).data as {
        display_name: string | null; nickname: string | null;
        member_number: number | null; show_member_number: boolean | null;
        email_reminders: boolean | null; email_reengagement: boolean | null;
        email_duel_notifications: boolean | null; created_at: string | null;
        avatar_color: string | null; has_password: boolean | null;
      } | null

      setHasPassword(profile?.has_password === true)

      const name = profile?.display_name ?? ''
      setDisplayName(name)
      setEditName(name)
      setNickname(profile?.nickname ?? '')
      setEditNickname(profile?.nickname ?? '')

      // Premium: hent server-side for å omgå RLS
      let premium = false
      try {
        const premRes = await fetch('/api/profile/premium-status', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (premRes.ok) {
          const premData = await premRes.json()
          premium = premData.isPremium === true
          setHasStripeCustomer(premData.hasStripeCustomer === true)
        }
      } catch { /* fallback: not premium */ }
      setIsPremium(premium)
      setAvatarUrl(avatarUrlFromMeta)
      setAvatarColor(profile?.avatar_color ?? null)
      setShowMemberNumber(profile?.show_member_number ?? false)

      // Beregn medlemsnummer dynamisk basert på registreringsrekkefølge (created_at)
      if (profile?.created_at) {
        try {
          const { count } = await supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .lt('created_at', profile.created_at)
          if (!cancelled) setMemberNumber((count ?? 0) + 1)
        } catch { /* behold null */ }
      }
      setEmailReminders(profile?.email_reminders ?? true)
      setEmailReengagement(profile?.email_reengagement ?? true)
      setEmailDuelNotifications(profile?.email_duel_notifications ?? true)
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
      loadProfile(session.user.id, session.access_token, avatarUrl, session.user.email ?? null).catch(
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
        loadProfile(session.user.id, session.access_token, avatarUrl, session.user.email ?? null).catch(
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

  async function handleSaveNickname() {
    if (!userId) return
    setSavingNickname(true)
    setNicknameError(null)
    setNicknameSuccess(false)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      // Egen lettvekts-rute uten navnevalidering — kallenavn har kun maks-20-regel
      const res = await fetch('/api/profile/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ nickname: editNickname.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNicknameError(data.error ?? 'Noe gikk galt. Prøv igjen.')
      } else {
        setNickname(editNickname.trim())
        setNicknameSuccess(true)
        setTimeout(() => setNicknameSuccess(false), 3000)
      }
    } catch {
      setNicknameError('Noe gikk galt. Prøv igjen.')
    } finally {
      setSavingNickname(false)
    }
  }

  async function savePref(patch: Record<string, boolean>, key: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/profile/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(patch),
      })
      setPrefSavedKey(key)
      setTimeout(() => setPrefSavedKey(null), 2000)
    } catch { /* silent — optimistic update already applied */ }
  }

  async function handleToggleGlobalLeague(org: OrgEntry) {
    // Synlig nasjonalt = ikke aktivt fravalgt. Toggling setter eksplisitt verdi.
    const visible = org.globalLeagueOptOut !== true
    const newOptOut = visible ? true : false
    setOrgs(prev => prev.map(o => o.orgId === org.orgId ? { ...o, globalLeagueOptOut: newOptOut } : o))
    setGlobalPrefSavedOrg(org.orgId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch(`/api/org/${org.orgSlug}/league-preference`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ opt_out: newOptOut }),
      })
      setTimeout(() => setGlobalPrefSavedOrg(null), 2000)
    } catch { /* optimistisk oppdatering allerede gjort */ }
  }

  function handleToggleEmailReminders() {
    const next = !emailReminders
    setEmailReminders(next)
    savePref({ email_reminders: next }, 'reminders')
  }

  function handleToggleEmailReengagement() {
    const next = !emailReengagement
    setEmailReengagement(next)
    savePref({ email_reengagement: next }, 'reengagement')
  }

  function handleToggleEmailDuelNotifications() {
    const next = !emailDuelNotifications
    setEmailDuelNotifications(next)
    savePref({ email_duel_notifications: next }, 'duel')
  }

  async function handleTogglePush() {
    if (pushLoading) return
    setPushLoading(true)
    try {
      if (!pushEnabled) {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') { setPushLoading(false); return }
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidKey) { setPushLoading(false); return }
        const reg = await navigator.serviceWorker.ready
        const padding = '='.repeat((4 - (vapidKey.length % 4)) % 4)
        const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/')
        const raw = atob(base64)
        const key = Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
        const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setPushLoading(false); return }
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ subscription }),
        })
        setPushEnabled(true)
      } else {
        const reg = await navigator.serviceWorker.ready
        const subscription = await reg.pushManager.getSubscription()
        if (subscription) {
          const { data: { session } } = await supabase.auth.getSession()
          if (session) {
            await fetch('/api/push/unsubscribe', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ endpoint: subscription.endpoint }),
            })
          }
          await subscription.unsubscribe()
        }
        setPushEnabled(false)
      }
    } catch (err) {
      console.error('[ProfilPage push]', err)
    } finally {
      setPushLoading(false)
    }
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

  // Bruker uten passord: send samme e-postbekreftede lenke som /login gjør.
  // Bevisst IKKE en egen "sett passord direkte"-vei — én flyt å vedlikeholde,
  // og e-postbekreftelsen er uansett det som gjør /sett-passord trygg.
  async function handleSendSetPassword() {
    if (!userEmail || resetSending) return
    setResetSending(true)
    setPwError(null)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/sett-passord')}`,
      })
      if (error) {
        console.error('[profil] resetPasswordForEmail feilet:', error.message)
        setPwError('Kunne ikke sende lenken. Prøv igjen.')
      } else {
        setResetSent(true)
      }
    } catch {
      setPwError('Noe gikk galt. Prøv igjen.')
    } finally {
      setResetSending(false)
    }
  }

  // Bruker som allerede har passord: sesjonen er aktiv, så updateUser holder —
  // ingen e-postrunde nødvendig.
  async function handleChangePassword() {
    if (newPassword.length < 8) {
      setPwError('Passordet må være minst 8 tegn.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passordene er ikke like.')
      return
    }
    setPwSaving(true)
    setPwError(null)
    setPwSuccess(false)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        console.error('[profil] updateUser feilet:', error.message)
        setPwError('Kunne ikke lagre passordet. Prøv igjen.')
        return
      }
      setNewPassword('')
      setConfirmPassword('')
      setShowPwForm(false)
      setPwSuccess(true)
      setTimeout(() => setPwSuccess(false), 4000)
    } catch {
      setPwError('Noe gikk galt. Prøv igjen.')
    } finally {
      setPwSaving(false)
    }
  }

  async function handlePortal() {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      const data = await res.json()
      if (!res.ok) {
        setPortalError(data.error ?? 'Noe gikk galt. Prøv igjen.')
        setTimeout(() => setPortalError(null), 4000)
      } else if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setPortalError('Noe gikk galt. Prøv igjen.')
      setTimeout(() => setPortalError(null), 4000)
    } finally {
      setPortalLoading(false)
    }
  }

  if (loadState === 'loading') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', padding: '40px 20px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SkeletonCard rows={4} showHeader />
            <SkeletonCard rows={3} showHeader />
            <SkeletonCard rows={5} showHeader />
          </div>
        </div>
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

  const initial = getAvatarInitial(displayName, '–')
  const NAME_RE = /^[\p{L}\s\-']{2,40}$/u
  const nameValid = NAME_RE.test(editName.trim())
  const nameChanged = editName.trim() !== displayName
  const saveBtnDisabled = saving || !nameChanged || !nameValid

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.wrap}>
        <div style={s.page}>
          {/* Avatar + identity */}
          <div style={s.avatarSection}>
            {avatarUrl && !avatarColor ? (
              <img src={avatarUrl} alt="" width={64} height={64} style={{ borderRadius: '50%', objectFit: 'cover', width: 64, height: 64, border: '2px solid #2a2d38', marginBottom: 6, display: 'block' }} />
            ) : (
              <div style={{ ...s.avatar, background: avatarColor ?? '#2a2d38', border: `2px solid ${avatarColor ?? '#2a2d38'}` }}>{initial}</div>
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
            display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10,
          } : {
            display: 'grid', gridTemplateColumns: orgs.length > 0 ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 10,
          }}>
            {/* Visningsnavn + Påminnelser */}
            <div style={s.card}>
              <p style={s.sectionLabel}>Fornavn og etternavn</p>
              <p style={s.fieldHint}>Brukes til identifikasjon — vises under nicknamen din på leaderboard</p>
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

              {/* Kallenavn (valgfritt) */}
              <div style={{ marginTop: 20 }}>
                <p style={s.sectionLabel}>Nickname (valgfritt)</p>
                <p style={s.fieldHint}>Vil du hete noe annet på leaderboard? Skriv det her — maks 20 tegn</p>
                <div style={s.inputRow}>
                  <input
                    type="text"
                    value={editNickname}
                    onChange={e => { setEditNickname(e.target.value); setNicknameError(null); setNicknameSuccess(false) }}
                    onKeyDown={e => { if (e.key === 'Enter' && editNickname.trim() !== nickname.trim() && !savingNickname) handleSaveNickname() }}
                    placeholder="F.eks. Kalle"
                    maxLength={20}
                    style={s.input}
                  />
                  <button
                    onClick={handleSaveNickname}
                    disabled={savingNickname || editNickname.trim() === nickname.trim()}
                    style={{
                      padding: '10px 22px',
                      background: 'transparent',
                      color: (savingNickname || editNickname.trim() === nickname.trim()) ? '#7a7873' : '#e8e4dd',
                      border: `1px solid ${(savingNickname || editNickname.trim() === nickname.trim()) ? '#2a2d38' : '#e8e4dd'}`,
                      borderRadius: 10, fontSize: 14, fontWeight: 700,
                      fontFamily: "'Instrument Sans', sans-serif",
                      cursor: (savingNickname || editNickname.trim() === nickname.trim()) ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {savingNickname ? 'Lagrer...' : 'Lagre'}
                  </button>
                </div>
                {nicknameError && <p style={s.saveError}>{nicknameError}</p>}
                {nicknameSuccess && <p style={s.saveSuccess}>Kallenavn oppdatert!</p>}
              </div>

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

          {/* Nasjonal toppliste — kun hvis medlem av minst én org som tillater global liga */}
          {orgs.some(o => o.allowGlobalLeague) && (
            <div style={{ ...s.card, marginBottom: 10 }}>
              <p style={s.sectionLabel}>Nasjonal toppliste</p>
              <p style={{ ...s.fieldHint, color: '#e8e4dd' }}>
                Velg om du vil vises på den nasjonale sesong-topplisten sammen med alle
                Quizkanonen-spillere. Du kan alltid være med på bedriftens interne liga uansett.
              </p>
              {orgs.filter(o => o.allowGlobalLeague).map((org, i) => {
                const visible = org.globalLeagueOptOut !== true
                return (
                  <div key={org.orgId}>
                    {i > 0 && <div style={s.cardDivider} />}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: '#e8e4dd', marginBottom: 2 }}>
                          Vis meg nasjonalt
                        </p>
                        <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.4 }}>
                          {org.orgName}
                          {globalPrefSavedOrg === org.orgId && <span style={{ color: '#4ade80', marginLeft: 8 }}>Lagret</span>}
                        </p>
                      </div>
                      <div
                        role="switch"
                        aria-checked={visible}
                        onClick={() => handleToggleGlobalLeague(org)}
                        style={{
                          width: 42, height: 24, borderRadius: 12,
                          background: visible ? '#c9a84c' : '#2a2d38',
                          position: 'relative', cursor: 'pointer', flexShrink: 0,
                          transition: 'background 0.2s',
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: 4,
                          left: visible ? 22 : 4,
                          width: 16, height: 16, borderRadius: '50%',
                          background: visible ? '#1a1c23' : '#e8e4dd',
                          transition: 'left 0.15s',
                        }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Statistikk — alltid synlig */}
          <div style={{ ...s.card, marginBottom: 10 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6,
              marginBottom: 12,
            }}>
              {[
                { val: isPremium && stats ? String(stats.total_attempts) : '—', lbl: 'Quizer spilt' },
                { val: isPremium && stats ? `${stats.avg_score_pct}%` : '—', lbl: 'Snitt score' },
                { val: isPremium && stats ? (stats.beste_plassering !== null ? `#${stats.beste_plassering}` : '—') : '—', lbl: 'Beste plassering' },
                { val: isPremium && stats ? String(stats.best_streak) : '—', lbl: 'Beste streak' },
              ].map(({ val, lbl }) => (
                <div key={lbl} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 4 }}>
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

          {/* E-postvarsler */}
          <div style={{ ...s.card, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <p style={{ ...s.sectionLabel, marginBottom: 0 }}>E-postvarsler</p>
              {prefSavedKey && (
                <span style={{ fontSize: 12, color: '#4ade80' }}>Lagret</span>
              )}
            </div>
            {([
              {
                key: 'reminders',
                title: 'Fredagspåminnelse',
                desc: 'Få e-post når ukens quiz er klar',
                value: emailReminders,
                toggle: handleToggleEmailReminders,
              },
              {
                key: 'reengagement',
                title: 'Aktivitetspåminnelse',
                desc: 'Få e-post hvis du ikke har spilt på to uker',
                value: emailReengagement,
                toggle: handleToggleEmailReengagement,
              },
              {
                key: 'duel',
                title: 'Duell-utfordringer',
                desc: 'Få e-post når noen utfordrer deg til duell',
                value: emailDuelNotifications,
                toggle: handleToggleEmailDuelNotifications,
              },
            ] as { key: string; title: string; desc: string; value: boolean; toggle: () => void }[]).map((item, i) => (
              <div key={item.key}>
                {i > 0 && <div style={s.cardDivider} />}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#e8e4dd', marginBottom: 2 }}>{item.title}</p>
                    <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.4 }}>{item.desc}</p>
                  </div>
                  <div
                    role="switch"
                    aria-checked={item.value}
                    onClick={item.toggle}
                    style={{
                      width: 42, height: 24, borderRadius: 12,
                      background: item.value ? '#c9a84c' : '#2a2d38',
                      position: 'relative', cursor: 'pointer', flexShrink: 0,
                      transition: 'background 0.2s',
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: 4,
                      left: item.value ? 22 : 4,
                      width: 16, height: 16, borderRadius: '50%',
                      background: item.value ? '#1a1c23' : '#7a7873',
                      transition: 'left 0.15s',
                    }} />
                  </div>
                </div>
              </div>
            ))}

            {pushSupported && (
              <>
                <div style={s.cardDivider} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#e8e4dd', marginBottom: 2 }}>Push-varsler</p>
                    <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.4 }}>
                      {pushEnabled ? 'Aktivert — du får varsel når quizen åpner' : 'Få push-varsel til enheten når quizen er klar'}
                    </p>
                  </div>
                  <div
                    role="switch"
                    aria-checked={pushEnabled}
                    onClick={handleTogglePush}
                    style={{
                      width: 42, height: 24, borderRadius: 12,
                      background: pushEnabled ? '#c9a84c' : '#2a2d38',
                      position: 'relative', cursor: pushLoading ? 'default' : 'pointer', flexShrink: 0,
                      transition: 'background 0.2s',
                      opacity: pushLoading ? 0.6 : 1,
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: 4,
                      left: pushEnabled ? 22 : 4,
                      width: 16, height: 16, borderRadius: '50%',
                      background: pushEnabled ? '#1a1c23' : '#7a7873',
                      transition: 'left 0.15s',
                    }} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Passord */}
          <div style={{ ...s.card, marginBottom: 10 }}>
            <p style={s.sectionLabel}>Passord</p>

            {!hasPassword ? (
              /* Ingen passord ennå — send e-postbekreftet lenke (samme flyt som /login) */
              resetSent ? (
                <p style={{ fontSize: 14, color: '#4ade80', lineHeight: 1.5 }}>
                  Vi har sendt en lenke til {userEmail}. Klikk den for å velge passord.
                </p>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 2 }}>Du har ikke satt passord</p>
                    <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.4 }}>
                      Med passord kan du logge inn uten å være avhengig av Google
                    </p>
                  </div>
                  <button
                    onClick={handleSendSetPassword}
                    disabled={resetSending || !userEmail}
                    style={resetSending || !userEmail ? s.pwBtnDis : s.pwBtn}
                  >
                    {resetSending ? 'Sender…' : 'Sett passord'}
                  </button>
                </div>
              )
            ) : !showPwForm ? (
              /* Har passord — direkte endring, siden sesjonen allerede er aktiv */
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 2 }}>Passord er satt</p>
                  <p style={{ fontSize: 12, color: '#7a7873', lineHeight: 1.4 }}>
                    Du kan logge inn med e-post og passord
                  </p>
                </div>
                <button onClick={() => { setShowPwForm(true); setPwError(null) }} style={s.pwBtn}>
                  Endre passord
                </button>
              </div>
            ) : (
              <>
                <p style={s.fieldHint}>Velg et nytt passord på minst 8 tegn.</p>
                <PasswordInput
                  value={newPassword}
                  onChange={v => { setNewPassword(v); setPwError(null) }}
                  placeholder="Nytt passord"
                  autoComplete="new-password"
                  style={s.input}
                  marginBottom={10}
                />
                <PasswordInput
                  value={confirmPassword}
                  onChange={v => { setConfirmPassword(v); setPwError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter' && !pwSaving) handleChangePassword() }}
                  placeholder="Gjenta nytt passord"
                  autoComplete="new-password"
                  style={s.input}
                  marginBottom={12}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={handleChangePassword}
                    disabled={pwSaving || newPassword.length < 8 || !confirmPassword}
                    style={pwSaving || newPassword.length < 8 || !confirmPassword ? s.pwBtnDis : s.pwBtn}
                  >
                    {pwSaving ? 'Lagrer…' : 'Lagre passord'}
                  </button>
                  <button
                    onClick={() => {
                      setShowPwForm(false); setNewPassword(''); setConfirmPassword(''); setPwError(null)
                    }}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: '#e8e4dd', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", textDecoration: 'underline' }}
                  >
                    Avbryt
                  </button>
                </div>
              </>
            )}

            {pwError && <p style={s.saveError}>{pwError}</p>}
            {pwSuccess && <p style={s.saveSuccess}>Passord oppdatert!</p>}
          </div>

          {/* Abonnement — kun for Premium-brukere */}
          {isPremium && (
            <div style={{ ...s.card, marginBottom: 10 }}>
              <p style={s.sectionLabel}>Abonnement</p>
              {hasStripeCustomer ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 2 }}>Premium — aktivt</p>
                      <p style={{ fontSize: 12, color: '#7a7873' }}>kr 49/mnd · Avslutt når du vil</p>
                    </div>
                    <button
                      onClick={handlePortal}
                      disabled={portalLoading}
                      style={{
                        background: 'transparent',
                        border: '1px solid #2a2d38',
                        color: portalLoading ? '#7a7873' : '#e8e4dd',
                        fontFamily: "'Instrument Sans', sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '9px 18px',
                        borderRadius: 10,
                        cursor: portalLoading ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {portalLoading ? 'Åpner…' : 'Administrer abonnement'}
                    </button>
                  </div>
                  {portalError && <p style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>{portalError}</p>}
                </>
              ) : (
                <div>
                  <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 8 }}>
                    Du har gratis Premium-tilgang. Abonnementsadministrasjon er tilgjengelig når du tegner et betalt abonnement.
                  </p>
                  <a href="/premium" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'underline' }}>
                    Se Premium-funksjoner →
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Verdikode */}
          <div style={{ marginBottom: 10, paddingTop: 4 }}>
            {!showRedeem ? (
              <button
                onClick={() => setShowRedeem(true)}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: '#e8e4dd', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", textDecoration: 'underline', textDecorationColor: '#e8e4dd' }}
              >
                Har du en verdikode? →
              </button>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}>
                  <input
                    type="text"
                    value={codeInput}
                    onChange={e => { setCodeInput(e.target.value.toUpperCase()); setCodeError(null); setCodeSuccess(null) }}
                    onKeyDown={e => { if (e.key === 'Enter' && !codeLoading && codeInput.trim()) handleRedeemCode() }}
                    placeholder="Verdikode"
                    maxLength={60}
                    autoFocus
                    style={s.redeemInput}
                    onFocus={e => { e.currentTarget.style.borderColor = '#c9a84c' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
                  />
                  <button
                    onClick={handleRedeemCode}
                    disabled={codeLoading || !codeInput.trim()}
                    style={codeLoading || !codeInput.trim() ? s.redeemBtnDis : s.redeemBtn}
                  >
                    {codeLoading ? 'Løser inn…' : 'Løs inn'}
                  </button>
                </div>
                {codeSuccess && <p style={{ fontSize: 12, color: '#4ade80', marginTop: 6 }}>{codeSuccess}</p>}
                {codeError && <p style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>{codeError}</p>}
              </>
            )}
          </div>

          {/* Slett konto */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #2a2d38', textAlign: 'center' }}>
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
                textDecoration: 'underline', textDecorationColor: '#7a7873',
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
