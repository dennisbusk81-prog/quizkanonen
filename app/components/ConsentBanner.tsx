'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const CONSENT_KEY = 'quizkanonen_consent_v1'

export default function ConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY)
    if (!consent) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true, date: new Date().toISOString() }))
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Personvernsamtykke"
      style={{
        position: 'fixed',
        bottom: '1.25rem',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 2.5rem)',
        maxWidth: '560px',
        background: '#21242e',
        border: '1px solid #2a2d38',
        borderRadius: '16px',
        padding: '1.25rem 1.5rem',
        zIndex: 9999,
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        fontFamily: "'Instrument Sans', sans-serif",
      }}
    >
      <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
        {/* Ikon */}
        <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: '1px' }}>🍪</span>

        {/* Tekst */}
        <div>
          <p style={{ color: '#e8e0d0', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Vi bruker kun nødvendige data
          </p>
          <p style={{ color: '#8a8d9a', fontSize: '0.85rem', lineHeight: 1.65 }}>
            Quizkanonen lagrer en enhets-ID lokalt i nettleseren for å hindre dobbeltspilling. 
            Vi bruker ingen sporings-cookies eller reklame. Les mer i vår{' '}
            <Link href="/personvern" style={{ color: '#c9a84c', textDecoration: 'underline' }}>
              personvernerklæring
            </Link>
            {' '}og{' '}
            <Link href="/vilkar" style={{ color: '#c9a84c', textDecoration: 'underline' }}>
              brukervilkår
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Knapper */}
      <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
        <button
          onClick={accept}
          style={{
            background: '#c9a84c',
            color: '#1a1c23',
            border: 'none',
            borderRadius: '10px',
            padding: '0.6rem 1.4rem',
            fontSize: '0.875rem',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          Forstått
        </button>
      </div>
    </div>
  )
}