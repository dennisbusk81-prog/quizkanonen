'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { signInWithGoogle } from '@/lib/auth'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import type { Session } from '@supabase/supabase-js'

const STORAGE_KEY = 'qk-bedrift-pending'

const PLANS = [
  { id: 'starter',  label: 'Starter',  price: '499 kr/mnd',   desc: 'Opptil 25 ansatte · 1 quiz/uke' },
  { id: 'standard', label: 'Standard', price: '899 kr/mnd',   desc: 'Opptil 50 ansatte · 3 quizer/uke', featured: true },
  { id: 'pro',      label: 'Pro',      price: '1 499 kr/mnd', desc: 'Opptil 100 ansatte · 5+ quizer/uke' },
]

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

export default function BedriftRegistrerPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [orgName, setOrgName] = useState('')
  const [plan, setPlan] = useState('standard')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Pick up plan from query string
    const p = new URLSearchParams(window.location.search).get('plan')
    if (p && PLANS.some(x => x.id === p)) setPlan(p)

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s) {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (raw) {
          try {
            const saved = JSON.parse(raw)
            if (saved.orgName) setOrgName(saved.orgName)
            if (saved.plan)    setPlan(saved.plan)
          } catch { /* ignore */ }
          sessionStorage.removeItem(STORAGE_KEY)
        }
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (raw) {
          try {
            const saved = JSON.parse(raw)
            if (saved.orgName) setOrgName(saved.orgName)
            if (saved.plan)    setPlan(saved.plan)
          } catch { /* ignore */ }
          sessionStorage.removeItem(STORAGE_KEY)
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const saveAndLogin = () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ orgName, plan }))
    signInWithGoogle('/bedrift/registrer')
  }

  const handleSubmit = async () => {
    if (!orgName.trim()) { setError('Oppgi et bedriftsnavn.'); return }
    if (!session) { saveAndLogin(); return }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/org-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ organizationName: orgName.trim(), plan }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Noe gikk galt. Prøv igjen.'); return }
      if (data.url) window.location.href = data.url
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  if (session === undefined) {
    return (
      <>
        <style>{FONT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' }}>Laster…</p>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{FONT + ' * { box-sizing: border-box; }'}</style>
      <UserMenuWrapper />
      <div style={{ minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' }}>
        <div style={{ maxWidth: 500, margin: '0 auto', padding: '48px 20px 80px' }}>

          <Link href="/bedrift" style={{ display: 'inline-block', fontSize: 12, color: '#7a7873', textDecoration: 'none', marginBottom: 32, letterSpacing: '0.04em' }}>
            ← Tilbake
          </Link>

          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8 }}>
            Quizkanonen for bedrifter
          </p>
          <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Registrer <em style={{ fontStyle: 'italic', color: '#c9a84c' }}>bedriften</em>
          </h1>
          <p style={{ fontSize: 14, color: '#7a7873', marginBottom: 32, lineHeight: 1.6 }}>
            Velg plan og betal via Stripe. Ingen binding — avslutt når du vil.
          </p>

          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px 24px' }}>

            {/* Org name */}
            <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7873', display: 'block', marginBottom: 8 }}>
              Bedriftsnavn
            </label>
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="Acme AS"
              autoFocus
              style={{ width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '12px 16px', fontSize: 15, color: '#ffffff', fontFamily: "'Instrument Sans', sans-serif", outline: 'none' }}
            />

            {/* Plan selection */}
            <div style={{ marginTop: 24 }}>
              <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7873', display: 'block', marginBottom: 10 }}>
                Velg plan
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {PLANS.map(p => {
                  const selected = plan === p.id
                  return (
                    <div
                      key={p.id}
                      onClick={() => setPlan(p.id)}
                      style={{
                        background: selected ? (p.featured ? '#1e1a0e' : 'rgba(201,168,76,0.04)') : '#1a1c23',
                        border: selected ? '1.5px solid #c9a84c' : '1px solid #2a2d38',
                        borderRadius: 10,
                        padding: '14px 16px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                      }}
                    >
                      <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${selected ? '#c9a84c' : '#2a2d38'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {selected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#c9a84c' }} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: 2 }}>
                          {p.label}{p.featured ? ' — mest populær' : ''}
                        </div>
                        <div style={{ fontSize: 12, color: '#c9a84c', fontWeight: 600 }}>{p.price}</div>
                        <div style={{ fontSize: 11, color: '#7a7873', marginTop: 1 }}>{p.desc}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ height: 1, background: '#2a2d38', margin: '24px 0' }} />

            {!session ? (
              <>
                <button
                  onClick={saveAndLogin}
                  style={{ width: '100%', background: '#ffffff', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 15, fontWeight: 600, padding: '13px', borderRadius: 10, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
                    <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
                    <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
                    <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
                  </svg>
                  Logg inn med Google for å fortsette
                </button>
                <p style={{ fontSize: 12, color: '#7a7873', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
                  Skjemaet er lagret — du sendes til betaling etter innlogging
                </p>
              </>
            ) : (
              <>
                <button
                  onClick={handleSubmit}
                  disabled={loading || !orgName.trim()}
                  style={{ width: '100%', background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 15, fontWeight: 700, padding: '13px', borderRadius: 10, border: 'none', cursor: loading || !orgName.trim() ? 'not-allowed' : 'pointer', opacity: loading || !orgName.trim() ? 0.4 : 1 }}
                >
                  {loading ? 'Sender...' : 'Gå til betaling →'}
                </button>
                <p style={{ fontSize: 12, color: '#7a7873', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
                  Betaling håndteres sikkert av Stripe. Ingen binding.
                </p>
              </>
            )}

            {error && (
              <div style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '10px 14px', marginTop: 14, lineHeight: 1.5 }}>
                {error}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
