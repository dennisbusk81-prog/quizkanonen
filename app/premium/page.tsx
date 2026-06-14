'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import UserMenuWrapper from '@/components/UserMenuWrapper'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const PLAN = { id: 'monthly', name: 'Premium månedlig', price: 'kr 49/mnd', desc: 'Ubegrenset tilgang, avslutt når som helst', priceId: 'STRIPE_PRICE_PREMIUM_MONTHLY' }

const FEATURES = [
  'Nøyaktig plassering på leaderboard',
  'Full sesong-toppliste — søk og bla gjennom alle spillere',
  'H2H Duell — utfordre en fast rival over sesongen',
  'Historikk og statistikk',
  'Private ligaer med venner',
]

export default function PremiumPage() {
  const [loading, setLoading] = useState(false)
  const [showLoginAlert, setShowLoginAlert] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  function showError(msg: string) {
    setCheckoutError(msg)
    setTimeout(() => setCheckoutError(null), 5000)
  }

  async function handleCheckout() {
    setCheckoutError(null)
    // Sesjon er ikke lastet ennå — ikke vis feil, bare vent
    if (session === undefined) return
    if (!session) {
      setShowLoginAlert(true)
      return
    }
    setLoading(true)
    try {
      const { data: { session: freshSession } } = await supabase.auth.getSession()
      if (!freshSession?.access_token) {
        setShowLoginAlert(true)
        return
      }
      const plan = PLAN
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${freshSession.access_token}`,
        },
        body: JSON.stringify({
          priceId: plan.priceId,
          userId: freshSession.user.id,
          email: freshSession.user.email,
        }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        showError('Noe gikk galt. Prøv igjen eller kontakt oss.')
      }
    } catch {
      showError('Noe gikk galt. Prøv igjen eller kontakt oss.')
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
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {FEATURES.map(f => (
                <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 15, color: '#e8e4dd', lineHeight: 1.4 }}>
                  <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 16, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {/* Pricing */}
            <div style={{
              background: '#1a1c23',
              border: '2px solid #c9a84c',
              borderRadius: 12, padding: '20px 24px',
              marginBottom: 24,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#ffffff', marginBottom: 3 }}>{PLAN.name}</div>
                  <div style={{ fontSize: 12, color: '#e8e4dd' }}>{PLAN.desc}</div>
                </div>
                <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', flexShrink: 0 }}>
                  {PLAN.price}
                </div>
              </div>
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

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <button
                onClick={handleCheckout}
                disabled={loading || session === undefined}
                style={{
                  padding: '10px 28px',
                  background: (loading || session === undefined) ? '#2a2d38' : '#c9a84c',
                  color: (loading || session === undefined) ? '#7a7873' : '#1a1c23',
                  border: 'none', borderRadius: 10,
                  fontSize: 15, fontWeight: 700,
                  fontFamily: "'Instrument Sans', sans-serif",
                  cursor: (loading || session === undefined) ? 'not-allowed' : 'pointer',
                  opacity: session === undefined ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { if (!loading && session !== undefined) e.currentTarget.style.opacity = '0.88' }}
                onMouseLeave={e => { if (session !== undefined) e.currentTarget.style.opacity = '1' }}
              >
                {session === undefined ? 'Laster...' : loading ? 'Videresender...' : 'Gå til betaling'}
              </button>
              {checkoutError && (
                <p style={{ fontSize: 14, color: '#e8e4dd', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                  {checkoutError}
                </p>
              )}
            </div>

            <p style={{ fontSize: 12, color: '#e8e4dd', textAlign: 'center', lineHeight: 1.6 }}>
              Du må være innlogget for å kjøpe. Betaling håndteres trygt av Stripe.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
