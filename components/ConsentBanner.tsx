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
      aria-label="Informasjon om cookies"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        width: 'calc(100% - 32px)',
        maxWidth: 280,
        background: '#21242e',
        border: '1px solid #2a2d38',
        borderRadius: 12,
        padding: '14px 16px',
        zIndex: 1000,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        fontFamily: "'Instrument Sans', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Header row: text + X button */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <p style={{ fontSize: 12, color: '#e8e4dd', lineHeight: 1.4, margin: 0, flex: 1 }}>
          Vi bruker cookies for innlogging og for å forbedre opplevelsen.{' '}
          <Link href="/personvern" style={{ color: '#c9a84c', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            Les mer
          </Link>
        </p>
        <button
          onClick={accept}
          aria-label="Lukk"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            marginTop: -8,
            marginRight: -8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#7a7873',
            padding: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <button
        onClick={accept}
        style={{
          alignSelf: 'flex-start',
          background: '#c9a84c',
          color: '#1a1c23',
          border: 'none',
          borderRadius: 8,
          padding: '5px 14px',
          minHeight: 44,
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        Forstått
      </button>
    </div>
  )
}
