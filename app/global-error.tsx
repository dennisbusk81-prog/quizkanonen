'use client'

// ── Siste skanse ────────────────────────────────────────────────────────────
// Fanger feil som kastes i selve root layouten. Vanlige error.tsx-grenser
// ligger INNI layouten og rekker derfor ikke disse — uten denne fila får
// brukeren Next sin egen, umerkede standardfeilside, og Sentry får ingenting.
//
// Merk: global-error erstatter hele dokumentet, så den MÅ rendre <html> og
// <body> selv, og kan ikke arve fonter eller stiler fra root layouten. Derfor
// står fargene og typografien fra designsystemet eksplisitt her.

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

const styles = {
  body: {
    margin: 0,
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: '#1a1c23',
    color: '#e8e4dd',
    fontFamily: "'Instrument Sans', system-ui, -apple-system, sans-serif",
  },
  card: {
    maxWidth: '480px',
    width: '100%',
    background: '#21242e',
    border: '1px solid #2a2d38',
    borderRadius: '16px',
    padding: '28px',
    textAlign: 'center' as const,
  },
  title: {
    fontFamily: "'Libre Baskerville', Georgia, serif",
    fontSize: '22px',
    color: '#ffffff',
    margin: '0 0 12px',
  },
  text: { fontSize: '15px', lineHeight: 1.6, margin: '0 0 24px' },
  button: {
    background: '#c9a84c',
    color: '#1a1c23',
    border: 'none',
    borderRadius: '10px',
    padding: '10px 28px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  hint: { fontSize: '13px', color: '#918f8a', margin: '20px 0 0' },
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="no">
      <body style={styles.body}>
        <div style={styles.card}>
          <h1 style={styles.title}>Noe gikk galt</h1>
          <p style={styles.text}>
            Vi klarte ikke å vise denne siden. Feilen er rapportert automatisk,
            så vi vet om den.
          </p>
          <button style={styles.button} onClick={() => reset()}>
            Prøv igjen
          </button>
          {error.digest && <p style={styles.hint}>Feilkode: {error.digest}</p>}
        </div>
      </body>
    </html>
  )
}
