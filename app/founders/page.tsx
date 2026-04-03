'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AuthModal from '@/components/AuthModal'
import type { Session } from '@supabase/supabase-js'

const s = {
  page: {
    minHeight: '100vh',
    background: '#1a1c23',
    fontFamily: "'Instrument Sans', sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
  },
  inner: {
    maxWidth: 520,
    width: '100%',
  },
  eyebrow: {
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: '#c9a84c',
    marginBottom: 14,
  },
  logo: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(32px, 7vw, 44px)',
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.08,
    letterSpacing: '-0.02em',
    marginBottom: 48,
  },
  logoEm: {
    fontStyle: 'italic',
    color: '#c9a84c',
  },
  card: {
    background: '#21242e',
    border: '1px solid #2a2d38',
    borderRadius: 20,
    padding: '40px 36px',
  },
  heading: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(28px, 6vw, 36px)',
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '-0.02em',
    marginBottom: 12,
  },
  ingress: {
    fontFamily: "'Libre Baskerville', serif",
    fontStyle: 'italic',
    fontSize: 16,
    color: '#9a9590',
    marginBottom: 32,
    lineHeight: 1.5,
  },
  checkList: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 36px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
  },
  checkItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    fontSize: 15,
    color: '#e8e0d0',
    lineHeight: 1.4,
  },
  checkMark: {
    color: '#c9a84c',
    fontWeight: 700,
    fontSize: 16,
    flexShrink: 0,
    marginTop: 1,
  },
  btn: {
    width: '100%',
    padding: '15px 24px',
    background: '#c9a84c',
    color: '#0f0f10',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'Instrument Sans', sans-serif",
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    marginBottom: 14,
  },
  btnDisabled: {
    width: '100%',
    padding: '15px 24px',
    background: '#3a3d4a',
    color: '#6a6860',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'Instrument Sans', sans-serif",
    cursor: 'not-allowed',
    marginBottom: 14,
  },
  alreadyPremium: {
    background: 'rgba(201,168,76,0.08)',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 10,
    padding: '14px 18px',
    color: '#c9a84c',
    fontSize: 14,
    fontWeight: 600,
    textAlign: 'center' as const,
    marginBottom: 14,
  },
  disclaimer: {
    fontSize: 12,
    color: '#6a6860',
    lineHeight: 1.6,
    textAlign: 'center' as const,
  },
}

const PERKS = [
  '1 måned gratis — ingen kortinfo nødvendig',
  'Tilgang til alle Premium-funksjoner',
  'Kun tilgjengelig i en begrenset periode',
]

export default function FoundersPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function runActivate(accessToken: string) {
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/stripe/founders-activate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })
      const data = await res.json()
      if (data.success) {
        router.push('/founders/success')
      } else {
        setErrorMsg(data.error ?? 'Noe gikk galt. Prøv igjen.')
      }
    } catch {
      setErrorMsg('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  // Mount: kjør pending action hvis bruker kom tilbake fra OAuth
  useEffect(() => {
    async function checkPending() {
      const pending = localStorage.getItem('qk_pending_action')
      if (pending !== 'founders_checkout') return
      const { data: { session: s } } = await supabase.auth.getSession()
      if (!s?.access_token) return
      localStorage.removeItem('qk_pending_action')
      await runActivate(s.access_token)
    }
    checkPending()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (s?.user) {
        supabase
          .from('profiles')
          .select('premium_status')
          .eq('id', s.user.id)
          .maybeSingle()
          .then(({ data }) => setIsPremium(data?.premium_status === true))
        // Fullfør pending checkout etter OAuth-redirect
        if (event === 'SIGNED_IN') {
          const pending = localStorage.getItem('qk_pending_action')
          if (pending === 'founders_checkout' && s.access_token) {
            localStorage.removeItem('qk_pending_action')
            runActivate(s.access_token)
          }
        }
      } else {
        setIsPremium(false)
      }
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleActivate() {
    // getSession() is authoritative — don't rely on session state which may
    // not yet be set if onAuthStateChange hasn't fired INITIAL_SESSION.
    let { data: { session: s } } = await supabase.auth.getSession()
    if (!s) {
      await new Promise<void>(resolve => setTimeout(resolve, 500))
      const { data } = await supabase.auth.getSession()
      s = data.session
    }
    if (!s?.access_token) {
      localStorage.setItem('qk_pending_action', 'founders_checkout')
      setModalOpen(true)
      return
    }
    try {
      await runActivate(s.access_token)
    } catch {
      setErrorMsg('Noe gikk galt. Prøv igjen.')
    }
  }

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <p style={s.eyebrow}>Den ukentlige quizen</p>
        <h1 style={s.logo}>
          Quiz<em style={s.logoEm}>kanonen</em>
        </h1>

        <div style={s.card}>
          <h2 style={s.heading}>Founders Access</h2>
          <p style={s.ingress}>Du er blant de første. Det skal lønne seg.</p>

          <ul style={s.checkList}>
            {PERKS.map(perk => (
              <li key={perk} style={s.checkItem}>
                <span style={s.checkMark}>✓</span>
                <span>{perk}</span>
              </li>
            ))}
          </ul>

          {isPremium ? (
            <>
              <div style={s.alreadyPremium}>
                Du har allerede Premium — takk!
              </div>
              <div style={{ textAlign: 'center' }}>
                <a href="/" style={{ fontSize: 13, color: '#6a6860', textDecoration: 'none' }}>
                  ← Tilbake til forsiden
                </a>
              </div>
            </>
          ) : (
            <>
              <button
                style={loading ? s.btnDisabled : s.btn}
                onClick={handleActivate}
                disabled={loading}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                {loading ? 'Aktiverer...' : 'Start gratis måned'}
              </button>
              {errorMsg && (
                <p style={{ fontSize: 13, color: '#f87171', textAlign: 'center', marginBottom: 12 }}>
                  {errorMsg}
                </p>
              )}
            </>
          )}

          <p style={s.disclaimer}>
            Ingen binding. Avsluttes automatisk etter 30 dager med mindre du velger å fortsette.
          </p>
        </div>
      </div>

      <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} next="/founders" />
    </div>
  )
}
