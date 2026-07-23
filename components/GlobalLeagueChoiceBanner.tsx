'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/components/ProfileProvider'

// Vises kun når brukeren tilhører minst én org med allow_global_league=true
// OG ikke har besvart valget (global_league_opt_out === null) for den orgen.
// Org-policyen er taket: banneret tilbys ikke for orger med allow_global_league=false.
const SESSION_DISMISS_KEY = 'qk_global_league_banner_dismissed'

export default function GlobalLeagueChoiceBanner() {
  // Org-data kommer nå fra den delte ProfileProvider-contexten (ett /api/org/my-orgs
  // -kall per sesjon) i stedet for et eget onAuthStateChange+fetch her.
  const { myOrgs } = useProfile()
  const org = myOrgs.find(o => o.allowGlobalLeague && o.globalLeagueOptOut === null) ?? null

  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [hidden, setHidden] = useState(false)
  // choose()-suksess kan ikke lenger nulle ut "org" (den er avledet av context,
  // ikke lokal state) — en egen answered-flagg gir samme "skjul umiddelbart
  // etter svar"-oppførsel som før.
  const [answered, setAnswered] = useState(false)

  // Trenger fortsatt et ferskt access-token for choose()-kallet mot
  // league-preference — hentes lokalt kun når det faktisk finnes et ubesvart
  // valg å vise, ikke et nettverkskall til my-orgs.
  useEffect(() => {
    if (!org) return
    let cancelled = false
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setAccessToken(session?.access_token ?? null)
    })
    return () => { cancelled = true }
  }, [org?.orgId])

  // Avvist denne sesjonen — vis igjen ved neste innlogging
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') setHidden(true)
  }, [])

  async function choose(optOut: boolean) {
    if (!org || !accessToken || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/org/${org.orgSlug}/league-preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ opt_out: optOut }),
      })
      if (res.ok) setAnswered(true) // besvart — banneret vises ikke igjen
    } catch {
      /* lar banneret stå slik at brukeren kan prøve igjen */
    } finally {
      setSaving(false)
    }
  }

  function dismiss() {
    if (typeof window !== 'undefined') sessionStorage.setItem(SESSION_DISMISS_KEY, '1')
    setHidden(true)
  }

  if (!org || hidden || answered) return null

  return (
    <div style={{
      background: '#21242e',
      border: '1px solid #2a2d38',
      borderRadius: 16,
      padding: '20px 22px',
      marginTop: 20,
      position: 'relative',
    }}>
      <button
        onClick={dismiss}
        aria-label="Lukk"
        style={{
          position: 'absolute', top: 14, right: 14,
          background: 'none', border: 'none', padding: 4, cursor: 'pointer',
          lineHeight: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 1L13 13M13 1L1 13" stroke="#7a7873" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 8 }}>
        Sesong-toppliste
      </p>
      <p style={{ fontSize: 15, color: '#e8e4dd', lineHeight: 1.55, marginBottom: 16, paddingRight: 20 }}>
        Vil du vises på den nasjonale sesong-topplisten sammen med alle Quizkanonen-spillere,
        eller kun på {org.orgName} sin interne liga?
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => choose(false)}
          disabled={saving}
          style={{
            background: '#c9a84c', color: '#1a1c23', border: 'none',
            borderRadius: 10, padding: '10px 28px', fontSize: 14, fontWeight: 700,
            fontFamily: "'Instrument Sans', sans-serif", cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1, whiteSpace: 'nowrap',
          }}
        >
          Bli med i nasjonal toppliste
        </button>
        <button
          onClick={() => choose(true)}
          disabled={saving}
          style={{
            background: 'transparent', color: '#e8e4dd', border: '1px solid #e8e4dd',
            borderRadius: 10, padding: '10px 28px', fontSize: 14, fontWeight: 600,
            fontFamily: "'Instrument Sans', sans-serif", cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1, whiteSpace: 'nowrap',
          }}
        >
          Kun bedriftens liga
        </button>
      </div>
    </div>
  )
}
