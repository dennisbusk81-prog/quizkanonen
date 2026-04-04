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
    fontSize: 'clamp(22px, 5vw, 28px)',
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '-0.02em',
    marginBottom: 8,
  },
  activated: {
    fontSize: 13,
    fontWeight: 600,
    color: '#4ade80',
    letterSpacing: '0.04em',
    marginBottom: 24,
  },
  body: {
    fontSize: 15,
    color: '#9a9590',
    lineHeight: 1.65,
    marginBottom: 0,
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

const features = [
  { icon: '📊', label: 'Quizhistorikk og score-utvikling' },
  { icon: '🏆', label: 'Detaljert statistikk og beste streak' },
  { icon: '🔒', label: 'Private ligaer med venner og kolleger' },
]

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
          <p style={s.activated}>30 dager gratis tilgang er aktivert</p>

          {/* Feature list */}
          <div style={{ background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 12, padding: '16px 20px', marginBottom: 28, textAlign: 'left' as const }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#6a6860', marginBottom: 12, margin: '0 0 12px' }}>
              Du har nå tilgang til
            </p>
            {features.map(f => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{f.icon}</span>
                <span style={{ fontSize: 14, color: '#e0e0e0' }}>{f.label}</span>
              </div>
            ))}
          </div>

          <Link
            href="/"
            style={s.btn}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.88' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1' }}
          >
            Spill ukens quiz →
          </Link>

          {/* Disclaimer */}
          <div style={{ marginTop: 24, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 12, padding: '14px 18px', textAlign: 'left' as const }}>
            <p style={{ fontSize: 13, color: '#9a9590', lineHeight: 1.6, margin: '0 0 6px' }}>
              <strong style={{ color: '#e0e0e0' }}>Ingen automatisk trekk</strong> — du bestemmer selv om du vil fortsette etter prøveperioden.
            </p>
            <p style={{ fontSize: 13, color: '#9a9590', lineHeight: 1.6, margin: 0 }}>
              Vi sender deg en påminnelse på e-post før de 30 dagene utløper.
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
