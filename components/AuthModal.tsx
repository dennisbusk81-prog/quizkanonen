'use client'
import { useEffect, useRef } from 'react'
import AuthForm from '@/components/AuthForm'

// Kun innpakningen: overlay, lukkeknapp og overskrift. Selve innloggingen bor i
// AuthForm, som deles med /login — modalen hadde tidligere en helt egen flyt
// (kun Google + magic link, ingen passordfelt i det hele tatt), så en bruker som
// hadde satt passord kunne ikke bruke det herfra. Ikke gjenta det: legg endringer
// i innloggingen i AuthForm, ikke her.

type Props = {
  open: boolean
  onClose: () => void
  next?: string
  description?: string
}

const DEFAULT_DESCRIPTION = 'Logg inn for å se din plassering og følge utviklingen din over tid.'

export default function AuthModal({ open, onClose, next, description }: Props) {
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

  // Etter innlogging: gå til next hvis kallstedet ba om et bestemt mål (founders,
  // liga-invitasjon), ellers bli værende og laste siden på nytt — modalen åpnes
  // som regel midt i noe brukeren holder på med.
  const handleSuccess = () => {
    if (next) window.location.assign(next)
    else window.location.reload()
  }

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
        overflowY: 'auto',
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
        margin: 'auto',
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
            color: '#7a7873',
            fontSize: 20,
            cursor: 'pointer',
            lineHeight: 1,
            padding: 4,
          }}
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
          color: '#e8e4dd',
          textAlign: 'center',
          marginBottom: 28,
          lineHeight: 1.5,
        }}>
          {description ?? DEFAULT_DESCRIPTION}
        </p>

        <div style={{ height: 1, background: '#2a2d38', marginBottom: 24 }} />

        <AuthForm next={next} onSuccess={handleSuccess} variant="modal" />
      </div>
    </div>
  )
}
