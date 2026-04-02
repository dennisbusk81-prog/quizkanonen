'use client'
import { useEffect, useRef } from 'react'
import { signInWithGoogle } from '@/lib/auth'

type Props = {
  open: boolean
  onClose: () => void
  next?: string
}

export default function AuthModal({ open, onClose, next }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,11,15,0.72)',
        backdropFilter: 'blur(4px)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Logg inn"
    >
      <div style={{
        width: '100%',
        maxWidth: '360px',
        background: '#21242e',
        border: '1px solid #2a2d38',
        borderRadius: '20px',
        padding: '36px 28px 32px',
        position: 'relative',
      }}>
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Lukk"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            color: '#6a6860',
            fontSize: 20,
            cursor: 'pointer',
            lineHeight: 1,
            padding: 4,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#9a9590')}
          onMouseLeave={e => (e.currentTarget.style.color = '#6a6860')}
        >
          ×
        </button>

        {/* Header */}
        <p style={{
          fontFamily: "'Instrument Sans', sans-serif",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#c9a84c',
          textAlign: 'center',
          marginBottom: 8,
        }}>
          Quizkanonen
        </p>
        <h2 style={{
          fontFamily: "'Libre Baskerville', serif",
          fontSize: 24,
          fontWeight: 700,
          color: '#ffffff',
          textAlign: 'center',
          letterSpacing: '-0.01em',
          marginBottom: 6,
        }}>
          Logg <em style={{ fontStyle: 'italic', color: '#c9a84c' }}>inn</em>
        </h2>
        <p style={{
          fontFamily: "'Instrument Sans', sans-serif",
          fontSize: 13,
          color: '#6a6860',
          textAlign: 'center',
          marginBottom: 28,
          lineHeight: 1.5,
        }}>
          Logg inn for å se din plassering og følge utviklingen din over tid.
        </p>

        <div style={{ height: 1, background: '#2a2d38', marginBottom: 24 }} />

        {/* Google button */}
        <button
          onClick={() => signInWithGoogle(next)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: '#ffffff',
            color: '#1a1c23',
            fontFamily: "'Instrument Sans', sans-serif",
            fontSize: 15,
            fontWeight: 600,
            padding: '13px 20px',
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s, transform 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f0f0f0'; e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.transform = 'none' }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
            <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
            <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
            <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
          </svg>
          Fortsett med Google
        </button>

        <p style={{
          fontFamily: "'Instrument Sans', sans-serif",
          fontSize: 11,
          color: '#6a6860',
          textAlign: 'center',
          marginTop: 16,
          lineHeight: 1.6,
        }}>
          Ved å logge inn godtar du våre{' '}
          <a href="/vilkar" style={{ color: '#c9a84c', textDecoration: 'underline' }}>vilkår</a>
          {' '}og{' '}
          <a href="/personvern" style={{ color: '#c9a84c', textDecoration: 'underline' }}>personvernerklæringen</a>.
        </p>
      </div>
    </div>
  )
}
