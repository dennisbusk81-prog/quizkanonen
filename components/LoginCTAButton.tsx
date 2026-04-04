'use client'

import { useState } from 'react'
import AuthModal from './AuthModal'

export default function LoginCTAButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-block',
          padding: '9px 20px',
          background: 'transparent',
          border: '0.5px solid #4a4d5a',
          borderRadius: 10,
          color: '#e8e4dd',
          fontFamily: "'Instrument Sans', sans-serif",
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#7a7d8a'; e.currentTarget.style.color = '#ffffff' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#4a4d5a'; e.currentTarget.style.color = '#e8e4dd' }}
      >
        Logg inn gratis
      </button>
      <AuthModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
