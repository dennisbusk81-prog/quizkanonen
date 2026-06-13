'use client'

import { useEffect, useState } from 'react'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

export default function UtfordringPage() {
  const [fra,     setFra]     = useState<string | null>(null)
  const [quiz,    setQuiz]    = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setFra(params.get('fra') ?? 'En spiller')
    setQuiz(params.get('quiz') ?? '')
    setMounted(true)
  }, [])

  const name = fra ?? 'En spiller'

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={{
        minHeight: '100vh',
        background: '#1a1c23',
        fontFamily: "'Instrument Sans', sans-serif",
        color: '#e8e4dd',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
      }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div style={{
            background: '#21242e',
            border: '1px solid #2a2d38',
            borderRadius: 16,
            padding: '36px 32px',
            textAlign: 'center',
          }}>
            <p style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#c9a84c',
              marginBottom: 14,
            }}>
              Du er utfordret
            </p>

            <h1 style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 'clamp(22px, 5vw, 28px)',
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.2,
              marginBottom: 14,
              minHeight: mounted ? undefined : 36,
            }}>
              {mounted ? `${name} utfordrer deg!` : ''}
            </h1>

            <p style={{ fontSize: 15, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 32, minHeight: mounted ? undefined : 48 }}>
              {mounted ? `Kan du slå ${name} på ukens quiz? Spill nå og se hvem som vinner.` : ''}
            </p>

            {!mounted ? (
              <div style={{ height: 44 }} />
            ) : quiz ? (
              <a
                href={`/quiz/${quiz}`}
                style={{
                  display: 'inline-block',
                  background: '#c9a84c',
                  color: '#1a1c23',
                  fontFamily: "'Instrument Sans', sans-serif",
                  fontSize: 15,
                  fontWeight: 600,
                  padding: '11px 28px',
                  borderRadius: 10,
                  textDecoration: 'none',
                }}
              >
                Ta imot utfordringen
              </a>
            ) : (
              <a
                href="/"
                style={{
                  display: 'inline-block',
                  background: '#c9a84c',
                  color: '#1a1c23',
                  fontFamily: "'Instrument Sans', sans-serif",
                  fontSize: 15,
                  fontWeight: 600,
                  padding: '11px 28px',
                  borderRadius: 10,
                  textDecoration: 'none',
                }}
              >
                Gå til Quizkanonen
              </a>
            )}

            <p style={{ fontSize: 13, color: '#7a7873', marginTop: 20 }}>
              <a href="/login" style={{ color: '#e8e4dd', textDecoration: 'underline' }}>
                Logg inn
              </a>
              {' '}for å lagre resultatet og utfordre andre
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
