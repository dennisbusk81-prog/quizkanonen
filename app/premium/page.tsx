'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import UserMenuWrapper from '@/components/UserMenuWrapper'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const PLANS = [
  { id: 'weekly',  name: 'Ukespass',          price: 'kr 19',     desc: '7 dagers full tilgang',                   priceId: 'STRIPE_PRICE_UKESPASS' },
  { id: 'monthly', name: 'Premium månedlig',   price: 'kr 49/mnd', desc: 'Ubegrenset tilgang, avslutt når som helst', priceId: 'STRIPE_PRICE_MONTHLY' },
]

const FEATURES = [
  'Nøyaktig plassering på leaderboard',
  'Historikk og statistikk',
  'Avansert statistikk',
  'Private ligaer (kommer)',
  'XP og titler (kommer)',
]

export default function PremiumPage() {
  const [selected, setSelected] = useState('monthly')
  const [loading, setLoading] = useState(false)
  const [showLoginAlert, setShowLoginAlert] = useState(false)
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  async function handleCheckout() {
    setLoading(true)
    try {
      if (!session) {
        setShowLoginAlert(true)
        return
      }
      const plan = PLANS.find(p => p.id === selected)!
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId: plan.priceId,
          userId: session.user.id,
          email: session.user.email,
        }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert('Noe gikk galt. Prøv igjen.')
      }
    } catch {
      alert('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <UserMenuWrapper />
      <div style={{
        minHeight: '100vh',
        background: '#1a1c23',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        fontFamily: "'Instrument Sans', sans-serif",
        color: '#e8e4dd',
      }}>
        <div style={{ maxWidth: 480, width: '100%' }}>

          <a href="/" style={{
            display: 'inline-block', fontSize: 12, color: '#7a7873',
            textDecoration: 'none', marginBottom: 28, letterSpacing: '0.04em',
            transition: 'color 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e8e4dd' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#7a7873' }}
          >
            ← Tilbake til forsiden
          </a>

          <p style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8,
          }}>
            Quizkanonen
          </p>
          <h1 style={{
            fontFamily: "'Libre Baskerville', serif",
            fontSize: 'clamp(28px, 6vw, 36px)',
            fontWeight: 700, color: '#ffffff',
            letterSpacing: '-0.02em', marginBottom: 32,
          }}>
            Bli <em style={{ fontStyle: 'italic', color: '#c9a84c' }}>Premium</em>
          </h1>

          <div style={{
            background: '#21242e', border: '1px solid #2a2d38',
            borderRadius: 20, padding: '32px',
          }}>

            {/* Feature list */}
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {FEATURES.map(f => (
                <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 15, color: '#e8e4dd', lineHeight: 1.4 }}>
                  <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 16, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {/* Plan cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {PLANS.map(plan => (
                <div
                  key={plan.id}
                  onClick={() => setSelected(plan.id)}
                  style={{
                    background: '#1a1c23',
                    border: selected === plan.id ? '2px solid #c9a84c' : '1px solid #2a2d38',
                    borderRadius: 12, padding: '16px 18px',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#ffffff', marginBottom: 3 }}>{plan.name}</div>
                      <div style={{ fontSize: 12, color: '#7a7873' }}>{plan.desc}</div>
                    </div>
                    <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', flexShrink: 0 }}>
                      {plan.price}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {showLoginAlert && (
              <div style={{
                background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.3)',
                borderRadius: 10, padding: '12px 16px', marginBottom: 16,
                color: '#c9a84c', fontSize: 13,
              }}>
                Du må være innlogget for å kjøpe Premium. Klikk &quot;Logg inn&quot; øverst til høyre.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <button
                onClick={handleCheckout}
                disabled={loading}
                style={{
                  padding: '10px 28px',
                  background: loading ? '#3a3d4a' : '#c9a84c',
                  color: loading ? '#7a7873' : '#0f0f10',
                  border: 'none', borderRadius: 10,
                  fontSize: 15, fontWeight: 700,
                  fontFamily: "'Instrument Sans', sans-serif",
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                {loading ? 'Laster...' : 'Gå til betaling'}
              </button>
            </div>

            <p style={{ fontSize: 12, color: '#7a7873', textAlign: 'center', lineHeight: 1.6 }}>
              Du må være innlogget for å kjøpe. Betaling håndteres trygt av Stripe.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
