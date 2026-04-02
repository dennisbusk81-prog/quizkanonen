'use client'

import { useEffect, useState } from 'react'
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
  const [session, setSession] = useState<Session | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

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
      } else {
        setIsPremium(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleCheckout() {
    if (!session) {
      setModalOpen(true)
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout-founders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.user.id, email: session.user.email }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error ?? 'Noe gikk galt. Prøv igjen.')
      }
    } catch {
      alert('Noe gikk galt. Prøv igjen.')
    }
    setLoading(false)
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
            <div style={s.alreadyPremium}>
              Du har allerede Premium — takk!
            </div>
          ) : (
            <button
              style={loading ? s.btnDisabled : s.btn}
              onClick={handleCheckout}
              disabled={loading}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
            >
              {loading ? 'Laster...' : 'Start gratis måned'}
            </button>
          )}

          <p style={s.disclaimer}>
            Ingen binding. Avsluttes automatisk etter 30 dager med mindre du velger å fortsette.
          </p>
        </div>
      </div>

      <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
