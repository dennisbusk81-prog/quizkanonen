import Link from 'next/link'

export const metadata = {
  title: 'Om Quizkanonen',
  description: 'Historien bak Quizkanonen — ukentlig fredagsquiz for folk som tar quiz på alvor.',
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
    marginBottom: 16,
  },
  rule: {
    width: '100%',
    height: 1,
    background: '#2a2d38',
    margin: '24px 0',
    border: 'none',
  },
  link: {
    color: '#e8e4dd',
    textDecoration: 'underline',
    textDecorationColor: 'rgba(232,228,221,0.3)',
    textUnderlineOffset: 3,
  },
}

export default function OmPage() {
  return (
    <div style={s.wrap}>
      <div style={s.page}>
        <header style={s.header}>
          <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          <p style={s.eyebrow}>Om Quizkanonen</p>
          <h1 style={s.title}>Om Quizkanonen</h1>
        </header>

        <div style={s.card}>

          <p style={s.body}>
            Quizkanonen er en ukentlig fredagsquiz for folk som liker å vinne — og å vite at de fortjente det.
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Historien</h2>
          <p style={s.body}>
            Jeg har laget og ledet quiz i over 20 år, både digitalt og live, i Norge og Spania. Da pandemien stengte alt ned i 2020, startet jeg en fredagsquiz for å holde samholdet oppe. Det som begynte som et tiltak ble raskt en tradisjon — og tradisjonen vokste til et fellesskap.
          </p>
          <p style={s.body}>
            Hver fredag samles de samme menneskene, hver for seg, og konkurrerer mot hverandre. Fra Norge, Sverige, Danmark og Spania — alle med én ting til felles: fredagsquizen.
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Hvem står bak</h2>
          <p style={s.body}>
            Quizkanonen drives av Dennis Busk. Jeg lager alle spørsmålene selv, og forsøker alltid å gi den beste quiz-opplevelsen — fordi jeg elsker quiz like mye som dere som spiller. Quizkanonen er bygget slik jeg selv ville ønsket det: den ultimate quizopplevelsen, fra en som har levd og åndet quiz i over to tiår.
          </p>
          <p style={s.body}>
            Jeg så behovet for en plattform der man konkurrerer over tid — ikke bare én enkelt kveld. Der du følger din egen utvikling uke etter uke, ser hvem som klatrer på topplisten, og kjenner at det faktisk betyr noe å møte opp neste fredag også.
          </p>
          <p style={s.body}>
            Jeg ser også verdien quiz skaper på en arbeidsplass — samholdet, spenningen, noe å se frem til. Derfor har jeg bygget Quizkanonen slik at enhver bedrift enkelt kan ta det i bruk, uten at noen trenger å lage et eneste spørsmål selv.
          </p>
          <p style={s.body}>
            Holder du quiz live og trenger en erfaren quizmaster? Jeg er tilgjengelig for private arrangementer og bedrifter —{' '}
            <a href="mailto:support@quizkanonen.no" style={s.link}>ta gjerne kontakt</a>.
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Følg med</h2>
          <p style={s.body}>
            Ukens quiz og resultater deles i vår Facebook-gruppe — alle er velkomne til å bli med.
          </p>
          <p style={{ ...s.body, marginBottom: 0 }}>
            <a
              href="https://www.facebook.com/groups/1623456494500339/"
              target="_blank"
              rel="noopener noreferrer"
              style={s.link}
            >
              Bli med i Facebook-gruppen →
            </a>
          </p>

          <hr style={s.rule} />

          <h2 style={s.sectionTitle}>Kontakt</h2>
          <p style={{ ...s.body, marginBottom: 0 }}>
            Spørsmål, tilbakemeldinger eller booking? Send en e-post til{' '}
            <a href="mailto:support@quizkanonen.no" style={s.link}>
              support@quizkanonen.no
            </a>
          </p>

        </div>
      </div>
    </div>
  )
}
