'use client'

import Link from 'next/link'

const s = {
  page: {
    minHeight: '100vh',
    background: '#1a1c23',
    fontFamily: "'Instrument Sans', sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
  },
  inner: {
    maxWidth: 520,
    width: '100%',
  },
  eyebrow: {
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: '#c9a84c',
    marginBottom: 14,
  },
  logo: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(32px, 7vw, 44px)',
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.08,
    letterSpacing: '-0.02em',
    marginBottom: 48,
  },
  logoEm: {
    fontStyle: 'italic',
    color: '#c9a84c',
  },
  card: {
    background: '#21242e',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 20,
    padding: '40px 36px',
    textAlign: 'center' as const,
  },
  heading: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(24px, 5vw, 30px)',
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '-0.02em',
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    color: '#9a9590',
    lineHeight: 1.65,
    marginBottom: 36,
  },
  btn: {
    display: 'inline-block',
    background: '#c9a84c',
    color: '#0f0f10',
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: 15,
    fontWeight: 700,
    padding: '14px 32px',
    borderRadius: 10,
    textDecoration: 'none',
    transition: 'opacity 0.15s',
  },
  btnBack: {
    display: 'inline-block',
    marginTop: 16,
    fontSize: 13,
    color: '#6a6860',
    textDecoration: 'none',
  },
}

export default function FoundersSuccessPage() {
  return (
    <div style={s.page}>
      <div style={s.inner}>
        <p style={s.eyebrow}>Den ukentlige quizen</p>
        <h1 style={s.logo}>
          Quiz<em style={s.logoEm}>kanonen</em>
        </h1>

        <div style={s.card}>
          <h2 style={s.heading}>Velkommen som Founder! 🎉</h2>
          <p style={s.body}>
            Din gratis måned er nå aktivert.
            Du har tilgang til alle Premium-funksjoner.
          </p>
          <Link
            href="/"
            style={s.btn}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.88' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1' }}
          >
            Gå til quizen
          </Link>
          <div style={{ marginTop: 24, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 12, padding: '14px 18px', textAlign: 'left' as const }}>
            <p style={{ fontSize: 13, color: '#9a9590', lineHeight: 1.6, margin: 0 }}>
              Etter 30 dager får du en e-post med spørsmål om du vil fortsette.
              Ingen automatisk trekk — du velger selv om du vil beholde Premium.
            </p>
          </div>
          <div>
            <Link href="/" style={s.btnBack}>← Tilbake til forsiden</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
