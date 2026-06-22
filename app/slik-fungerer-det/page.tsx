import Link from 'next/link'

export const metadata = {
  title: 'Slik fungerer det — Quizkanonen',
  description: 'Alt du trenger å vite om Quizkanonen — scoring, sesonger, private ligaer og forskjellen på gratis og Premium.',
}

const s = {
  wrap: {
    minHeight: '100vh',
    background: '#1a1c23',
    fontFamily: "'Instrument Sans', sans-serif",
    color: '#e8e4dd',
  },
  page: {
    maxWidth: 640,
    margin: '0 auto',
    padding: '0 20px 80px',
  },
  header: {
    padding: '48px 0 36px',
  },
  back: {
    display: 'inline-block',
    fontSize: 13,
    color: '#e8e4dd',
    textDecoration: 'none',
    marginBottom: 24,
    letterSpacing: '0.02em',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: '#c9a84c',
    marginBottom: 10,
  },
  title: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(28px, 6vw, 38px)' as string,
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '-0.02em',
    marginBottom: 0,
  },
  card: {
    background: '#21242e',
    border: '1px solid #2a2d38',
    borderRadius: 16,
    padding: '28px 28px',
  },
  sectionTitle: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 18,
    fontWeight: 700,
    color: '#ffffff',
    marginBottom: 12,
    marginTop: 28,
  },
  firstSectionTitle: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 18,
    fontWeight: 700,
    color: '#ffffff',
    marginBottom: 12,
    marginTop: 0,
  },
  body: {
    fontSize: 15,
    lineHeight: 1.7,
    color: '#e8e4dd',
    marginBottom: 0,
  },
  rule: {
    width: '100%',
    height: 1,
    background: '#2a2d38',
    margin: '24px 0',
    border: 'none',
  },
}

const pointsScale = [
  { label: '1. plass', pts: '12' },
  { label: '2. plass', pts: '10' },
  { label: '3. plass', pts: '8' },
  { label: '4.–10. plass', pts: '7–1' },
  { label: '11. plass +', pts: '1' },
]

export default function SlikFungererDetPage() {
  return (
    <div style={s.wrap}>
      <div style={s.page}>
        <header style={s.header}>
          <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          <p style={s.eyebrow}>Quizkanonen</p>
          <h1 style={s.title}>Slik fungerer det</h1>
        </header>

        <div style={s.card}>

          <h2 style={s.firstSectionTitle}>Fredagsquizen</h2>
          <p style={s.body}>
            Hver fredag kl. 12:00 åpner ukens quiz. Du har frem til deadline på å svare — spill når det passer deg på fredag. Vanligvis 15 spørsmål. Temaquizer og spesialquizer kan komme på andre tidspunkter — disse varsles på e-post.
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Scoring</h2>
          <p style={s.body}>
            Det handler ikke bare om å svare riktig — det handler om å svare raskt. To spillere med like mange riktige skilles av total tid brukt. Den raskeste vinner.
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Sesongen</h2>
          <p style={{ ...s.body, marginBottom: 16 }}>
            Quizkanonen kjøres i sesonger — måned, kvartal, år og all-time. Hver quiz gir deg sesong-poeng basert på plassering. Sesongene skifter automatisk. All-time viser summen av alle poeng du noen gang har samlet.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
            {pointsScale.map(({ label, pts }) => (
              <div key={label} style={{
                background: '#1a1c23',
                border: '1px solid #2a2d38',
                borderRadius: 10,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <span style={{ fontSize: 12, color: '#7a7873', whiteSpace: 'nowrap' as const }}>{label}</span>
                <span style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#c9a84c',
                  fontFamily: "'Libre Baskerville', serif",
                  whiteSpace: 'nowrap' as const,
                }}>{pts}p</span>
              </div>
            ))}
          </div>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Private ligaer</h2>
          <p style={s.body}>
            Vil du konkurrere mot venner, familie eller kolleger? Opprett en privat liga, del invitasjonslenken, og se hvem som er best i din krets — uke etter uke. Krever Premium å opprette.
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Bedriftsligaen</h2>
          <p style={s.body}>
            Bedrifter får sitt eget lukkede leaderboard — helt adskilt fra den globale topplisten. Alle ansatte logger inn med sitt eget navn. Ingen installasjon — del en lenke og alle er med.
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Påminnelse</h2>
          <p style={s.body}>
            Slå på e-postvarsling på profilen din så får du beskjed fredag morgen når ukens quiz er klar.
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Gratis vs Premium</h2>
          <style>{`
            @media (max-width: 520px) { .sgd-cols { grid-template-columns: 1fr !important; } }
          `}</style>
          <div className="sgd-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>

            {/* Gratis */}
            <div style={{ background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 12, padding: '16px 18px' }}>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', marginBottom: 12 }}>
                Gratis
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' as const, gap: 9 }}>
                {[
                  'Spill ukens quiz',
                  'Se antall riktige og svartid',
                  'Estimert plassering',
                  'Delta i sesong-topplisten',
                  'Bli med i private ligaer',
                ].map(item => (
                  <li key={item} style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: '#7a7873', flexShrink: 0, marginTop: 1 }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Premium */}
            <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 12, padding: '16px 18px' }}>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 12 }}>
                Premium · kr 49/mnd
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' as const, gap: 9 }}>
                <li style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.4, fontStyle: 'italic' }}>Alt i gratis, pluss:</li>
                {[
                  'Nøyaktig plassering på leaderboard',
                  'Full quizhistorikk uke for uke',
                  'Detaljert statistikk og utvikling over tid',
                  'Opprett egne private ligaer',
                  'Se hvem du slo og hvem som slo deg',
                ].map(item => (
                  <li key={item} style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: '#c9a84c', flexShrink: 0, marginTop: 1 }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

          </div>

          <div style={{ textAlign: 'center' }}>
            <Link href="/premium" style={{
              display: 'inline-block',
              background: '#c9a84c',
              color: '#1a1c23',
              fontFamily: "'Instrument Sans', sans-serif",
              fontSize: 15,
              fontWeight: 700,
              padding: '10px 28px',
              borderRadius: 10,
              textDecoration: 'none',
              whiteSpace: 'nowrap' as const,
            }}>
              Bli Premium →
            </Link>
          </div>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Ingen app nødvendig</h2>
          <p style={s.body}>
            Quizkanonen fungerer direkte i nettleseren — på mobil, nettbrett og desktop.
          </p>

        </div>
      </div>
    </div>
  )
}
