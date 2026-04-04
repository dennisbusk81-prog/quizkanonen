'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const s = {
  page: { minHeight: '100vh', background: '#1a1c23', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'Instrument Sans, sans-serif' },
  card: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: '20px', padding: '40px', maxWidth: '500px', width: '100%', textAlign: 'center' as const },
  icon: { fontSize: '3rem', marginBottom: '16px' },
  title: { fontFamily: 'Libre Baskerville, serif', fontSize: '2rem', color: '#c9a84c', marginBottom: '8px' },
  subtitle: { color: '#d0d3e0', marginBottom: '32px', fontSize: '1rem' },
  btn: { padding: '11px 28px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' },
  note: { color: '#8a8fa8', fontSize: '0.85rem', marginTop: '16px' },
}

export default function PremiumSuccessPage() {
  const router = useRouter()

  useEffect(() => {
    setTimeout(() => router.push('/'), 10000)
  }, [router])

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.icon}>🎉</div>
        <div style={s.title}>Velkommen til Premium!</div>
        <div style={s.subtitle}>
          Betalingen gikk gjennom. Du har nå full tilgang til alle Premium-funksjoner på Quizkanonen.
        </div>
        <button style={s.btn} onClick={() => router.push('/')}>
          Gå til forsiden
        </button>
        <div style={s.note}>Du blir automatisk sendt til forsiden om 10 sekunder.</div>
      </div>
    </div>
  )
}
