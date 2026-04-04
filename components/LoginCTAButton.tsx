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
          border: '1px solid #c9a84c',
          borderRadius: 10,
          color: '#c9a84c',
          fontFamily: "'Instrument Sans', sans-serif",
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(201,168,76,0.08)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        Logg inn gratis
      </button>
      <AuthModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
