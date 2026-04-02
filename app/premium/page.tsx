'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

const s = {
  page: { minHeight: '100vh', background: '#1a1c23', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'Instrument Sans, sans-serif' },
  card: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: '20px', padding: '40px', maxWidth: '500px', width: '100%', textAlign: 'center' as const },
  title: { fontFamily: 'Libre Baskerville, serif', fontSize: '2rem', color: '#c9a84c', marginBottom: '8px' },
  subtitle: { color: '#8a8fa8', marginBottom: '40px', fontSize: '1rem' },
  plans: { display: 'flex', flexDirection: 'column' as const, gap: '16px', marginBottom: '32px' },
  plan: { background: '#1a1c23', border: '2px solid #2a2d38', borderRadius: '12px', padding: '20px', cursor: 'pointer', transition: 'border-color 0.2s' },
  planSelected: { background: '#1a1c23', border: '2px solid #c9a84c', borderRadius: '12px', padding: '20px', cursor: 'pointer' },
  planName: { color: '#ffffff', fontWeight: 700, fontSize: '1.1rem', marginBottom: '4px' },
  planPrice: { color: '#c9a84c', fontSize: '1.5rem', fontWeight: 700 },
  planDesc: { color: '#8a8fa8', fontSize: '0.85rem', marginTop: '4px' },
  btn: { width: '100%', padding: '14px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' },
  btnDisabled: { width: '100%', padding: '14px', background: '#3a3d4a', color: '#8a8fa8', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, cursor: 'not-allowed' },
  features: { textAlign: 'left' as const, marginBottom: '32px' },
  feature: { color: '#c9a84c', marginBottom: '8px', fontSize: '0.95rem' },
  featureText: { color: '#d0d3e0' },
  loginNote: { color: '#8a8fa8', fontSize: '0.85rem', marginTop: '16px' },
}

const PLANS = [
  { id: 'weekly', name: 'Ukespass', price: 'kr 19', desc: '7 dagers full tilgang', priceId: 'STRIPE_PRICE_UKESPASS' },
  { id: 'monthly', name: 'Premium månedlig', price: 'kr 49/mnd', desc: 'Ubegrenset tilgang, avslutt når som helst', priceId: 'STRIPE_PRICE_MONTHLY' },
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
  const router = useRouter()

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
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.title}>Bli Premium</div>
        <div style={s.subtitle}>Få full tilgang til Quizkanonen</div>

        <div style={s.features}>
          {FEATURES.map(f => (
            <div key={f} style={s.feature}>✓ <span style={s.featureText}>{f}</span></div>
          ))}
        </div>

        <div style={s.plans}>
          {PLANS.map(plan => (
            <div key={plan.id} style={selected === plan.id ? s.planSelected : s.plan} onClick={() => setSelected(plan.id)}>
              <div style={s.planName}>{plan.name}</div>
              <div style={s.planPrice}>{plan.price}</div>
              <div style={s.planDesc}>{plan.desc}</div>
            </div>
          ))}
        </div>

        {showLoginAlert && (
          <div style={{ background: '#2a1a1a', border: '1px solid #c9a84c', borderRadius: '10px', padding: '12px', marginBottom: '12px', color: '#c9a84c' }}>
            Du må være innlogget for å kjøpe Premium. Klikk &quot;Logg inn&quot; øverst til høyre.
          </div>
        )}
        <button style={loading ? s.btnDisabled : s.btn} onClick={handleCheckout} disabled={loading}>
          {loading ? 'Laster...' : 'Gå til betaling'}
        </button>
        <div style={s.loginNote}>Du må være innlogget for å kjøpe. Betaling håndteres trygt av Stripe.</div>
      </div>
    </div>
  )
}
