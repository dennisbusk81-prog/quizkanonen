'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const s = {
  page: { minHeight: '100vh', background: '#1a1c23', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Instrument Sans', sans-serif" },
  card: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: '16px', padding: '40px', maxWidth: '500px', width: '100%', textAlign: 'center' as const },
  icon: { width: 56, height: 56, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' },
  title: { fontFamily: "'Libre Baskerville', serif", fontSize: '1.75rem', color: '#ffffff', marginBottom: '8px' },
  subtitle: { color: '#e8e4dd', marginBottom: '32px', fontSize: '1rem', lineHeight: 1.6 },
  loadingTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: '1.75rem', color: '#ffffff', marginBottom: '8px' },
  loadingSub: { color: '#7a7873', fontSize: '0.95rem', lineHeight: 1.6, fontStyle: 'italic' as const },
  btn: { display: 'inline-block', padding: '11px 28px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', textDecoration: 'none', fontFamily: "'Instrument Sans', sans-serif" },
}

function PremiumSuccessContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session_id')
  const [status, setStatus] = useState<'verifying' | 'paid'>('verifying')

  // Verifiser betalingen direkte mot Stripe via session_id — ikke avhengig av at
  // webhooken har rukket å sette premium_status i DB (unngår race condition).
  useEffect(() => {
    let cancelled = false
    async function verify() {
      if (!sessionId) { router.replace('/premium'); return }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { router.replace('/login'); return }
      try {
        const res = await fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = res.ok ? await res.json() : { paid: false }
        if (cancelled) return
        if (data.paid) setStatus('paid')
        else router.replace('/premium')
      } catch {
        if (!cancelled) router.replace('/premium')
      }
    }
    verify()
    return () => { cancelled = true }
  }, [sessionId, router])

  if (status === 'verifying') {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.icon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5 12l5 5L19 7" stroke="#c9a84c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={s.loadingTitle}>Aktiverer Premium…</div>
          <div style={s.loadingSub}>Vi bekrefter betalingen din. Et øyeblikk.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.icon}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5L19 7" stroke="#c9a84c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={s.title}>Velkommen til Premium!</div>
        <div style={s.subtitle}>
          Betalingen gikk gjennom. Du har nå full tilgang til alle Premium-funksjoner på Quizkanonen.
        </div>
        <Link href="/" style={s.btn}>
          Gå til forsiden
        </Link>
      </div>
    </div>
  )
}

export default function PremiumSuccessPage() {
  return (
    <Suspense fallback={null}>
      <PremiumSuccessContent />
    </Suspense>
  )
}
