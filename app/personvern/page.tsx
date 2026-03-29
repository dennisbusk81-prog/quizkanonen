export default function Personvern() {
  return (
    <main className="min-h-screen" style={{ background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');
        .page-title { font-family: 'Libre Baskerville', serif; }
        .section-title { font-family: 'Libre Baskerville', serif; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #2a2d38' }}>
        <div className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between">
          <a href="/" style={{ color: '#c9a84c', fontWeight: 600, fontSize: '1.1rem', textDecoration: 'none', fontFamily: "'Libre Baskerville', serif" }}>
            Quizkanonen
          </a>
          <span style={{ color: '#4a4d5a', fontSize: '0.85rem' }}>Sist oppdatert: mars 2025</span>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Title */}
        <div style={{ marginBottom: '3rem' }}>
          <p style={{ color: '#c9a84c', fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Juridisk
          </p>
          <h1 className="page-title" style={{ color: '#e8e0d0', fontSize: 'clamp(2rem, 5vw, 2.8rem)', fontWeight: 700, lineHeight: 1.2, marginBottom: '1rem' }}>
            Personvernerklæring
          </h1>
          <p style={{ color: '#8a8d9a', fontSize: '1.05rem', lineHeight: 1.7 }}>
            Vi tar personvernet ditt på alvor. Denne erklæringen forklarer hvilke opplysninger vi samler inn, 
            hvorfor, og hvilke rettigheter du har.
          </p>
        </div>

        {/* Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

          <Section title="1. Behandlingsansvarlig">
            <P>Quizkanonen drives av:</P>
            <Box>
              <strong style={{ color: '#e8e0d0' }}>[Dennis Busk]</strong><br />
              [Slåtteveien 12]<br />
              [1084 Oslo]<br />
              E-post: <a href="mailto:[quizkanonen@gmail.com]" style={{ color: '#c9a84c' }}>[din@epost.no]</a>
            </Box>
            <P>Ved spørsmål om behandling av personopplysninger kan du kontakte oss på e-postadressen over.</P>
          </Section>

          <Section title="2. Hva vi samler inn">
            <P>Vi samler inn minimalt med opplysninger for å gi deg en god quizopplevelse:</P>
            <Table rows={[
              ['Kallenavn / lagnavn', 'Du skriver inn selv ved quiz-start', 'Vises på leaderboard'],
              ['Enhets-ID (device ID)', 'Genereres automatisk i nettleseren din', 'Hindrer dobbeltspilling'],
              ['Quizsvar og resultater', 'Registreres automatisk under spilling', 'Leaderboard og statistikk'],
              ['Svartider', 'Registreres automatisk under spilling', 'Rangeringslogikk'],
              ['Tidspunkt for gjennomspilling', 'Registreres automatisk', 'Administrasjon og statistikk'],
            ]} />
            <P>Vi samler <strong style={{ color: '#e8e0d0' }}>ikke inn</strong> navn, e-postadresse, telefonnummer, betalingsinformasjon eller andre identifiserbare personopplysninger i den gratis versjonen av tjenesten.</P>
          </Section>

          <Section title="3. Rettslig grunnlag">
            <P>Vi behandler opplysningene på følgende rettslige grunnlag etter personvernforordningen (GDPR):</P>
            <ul style={{ color: '#8a8d9a', lineHeight: 1.8, paddingLeft: '1.5rem', fontSize: '0.95rem' }}>
              <li style={{ marginBottom: '0.5rem' }}><strong style={{ color: '#c9a84c' }}>Berettiget interesse (art. 6 (1) f)</strong> — for å forhindre dobbeltspilling og sikre rettferdig konkurranse</li>
              <li style={{ marginBottom: '0.5rem' }}><strong style={{ color: '#c9a84c' }}>Avtale (art. 6 (1) b)</strong> — for å levere quiz-tjenesten du aktivt velger å delta i</li>
              <li><strong style={{ color: '#c9a84c' }}>Samtykke (art. 6 (1) a)</strong> — for eventuelle analyser og statistikk utover det teknisk nødvendige</li>
            </ul>
          </Section>

          <Section title="4. Hvordan vi bruker opplysningene">
            <ul style={{ color: '#8a8d9a', lineHeight: 1.8, paddingLeft: '1.5rem', fontSize: '0.95rem' }}>
              <li style={{ marginBottom: '0.5rem' }}>Vise leaderboard med kallenavn og poengsum</li>
              <li style={{ marginBottom: '0.5rem' }}>Hindre at samme enhet spiller samme quiz flere ganger</li>
              <li style={{ marginBottom: '0.5rem' }}>Beregne rangeringslogikk (antall riktige, svartid, streak)</li>
              <li style={{ marginBottom: '0.5rem' }}>Vise anonymisert statistikk til quiz-arrangør (f.eks. gjennomsnittsscore per spørsmål)</li>
              <li>Forbedre tjenesten basert på aggregert bruksmønster</li>
            </ul>
            <P>Vi selger aldri opplysninger til tredjeparter og bruker dem ikke til markedsføring uten eksplisitt samtykke.</P>
          </Section>

          <Section title="5. Lagring og sletting">
            <Table rows={[
              ['Quizresultater og svar', 'Til quiz-arrangør sletter quizen', 'Supabase (EU)'],
              ['Enhets-ID / played_log', 'Til quiz-arrangør nullstiller quizen', 'Supabase (EU)'],
              ['Kallenavn på leaderboard', 'Til quiz slettes', 'Supabase (EU)'],
            ]} headers={['Datatype', 'Lagringstid', 'Sted']} />
            <P>Alle data lagres på servere i EU (Supabase, Frankfurt). Vi bruker ikke tjenester som overfører data til land utenfor EØS uten tilstrekkelig beskyttelsesnivå.</P>
          </Section>

          <Section title="6. Underleverandører (databehandlere)">
            <Table rows={[
              ['Supabase Inc.', 'Database og lagring', 'EU (Frankfurt)', 'DPA inngått'],
              ['Vercel Inc.', 'Webhosting', 'EU-region tilgjengelig', 'DPA inngått'],
            ]} headers={['Leverandør', 'Tjeneste', 'Datasentre', 'Avtale']} />
          </Section>

          <Section title="7. Dine rettigheter">
            <P>Etter GDPR har du følgende rettigheter:</P>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {[
                ['Innsyn (art. 15)', 'Be om kopi av opplysninger vi har om deg'],
                ['Retting (art. 16)', 'Korrigere uriktige opplysninger'],
                ['Sletting (art. 17)', 'Kreve at vi sletter dine opplysninger ("retten til å bli glemt")'],
                ['Begrensning (art. 18)', 'Be om at vi begrenser behandlingen mens en klage behandles'],
                ['Dataportabilitet (art. 20)', 'Motta opplysningene i et maskinlesbart format'],
                ['Innsigelse (art. 21)', 'Protestere mot behandling basert på berettiget interesse'],
              ].map(([right, desc]) => (
                <div key={right} style={{ display: 'flex', gap: '1rem', background: '#21242e', border: '1px solid #2a2d38', borderRadius: '10px', padding: '0.875rem 1rem' }}>
                  <span style={{ color: '#c9a84c', fontWeight: 600, fontSize: '0.85rem', minWidth: '160px', flexShrink: 0 }}>{right}</span>
                  <span style={{ color: '#8a8d9a', fontSize: '0.9rem' }}>{desc}</span>
                </div>
              ))}
            </div>
            <P>Send forespørsel til <a href="mailto:[quizkanonen@gmail.com]" style={{ color: '#c9a84c' }}>[quizkanonen@gmail.com]</a>. Vi svarer innen 30 dager.</P>
            <P>Du har også rett til å klage til <a href="https://www.datatilsynet.no" target="_blank" rel="noopener noreferrer" style={{ color: '#c9a84c' }}>Datatilsynet</a> (datatilsynet.no) dersom du mener vi behandler opplysningene dine i strid med personvernregelverket.</P>
          </Section>

          <Section title="8. Informasjonskapsler (cookies)">
            <P>Quizkanonen bruker kun teknisk nødvendige data lagret lokalt i nettleseren din (localStorage). Dette er ikke cookies i tradisjonell forstand og krever ikke samtykke etter ekomloven, men vi informerer om det her av hensyn til åpenhet:</P>
            <Table rows={[
              ['quizkanonen_device_id', 'localStorage', 'Unik enhets-ID for å hindre dobbeltspilling'],
              ['quizkanonen_admin_session', 'localStorage', 'Admin-innlogging (kun for admin-brukere)'],
              ['quiz_progress_[id]', 'localStorage', 'Lagrer fremgang ved internett-brudd'],
            ]} headers={['Nøkkel', 'Type', 'Formål']} />
            <P>Vi bruker ingen sporings-cookies, analysecookies (Google Analytics, Hotjar e.l.) eller reklamecookies.</P>
          </Section>

          <Section title="9. Barn og ungdom">
            <P>Quizkanonen er tilgjengelig for alle, men krever aldersbekreftelse (13+) ved registrering. Vi samler ikke bevisst inn opplysninger om barn under 13 år. Dersom du er forelder og mener barnet ditt har oppgitt opplysninger til oss, kontakt oss på <a href="mailto:[quizkanonen@gmail.com]" style={{ color: '#c9a84c' }}>[quizkanonen@gmail.com]</a> så sletter vi dataene umiddelbart.</P>
          </Section>

          <Section title="10. Endringer i erklæringen">
            <P>Vi kan oppdatere denne erklæringen ved behov. Datoen øverst på siden viser når den sist ble revidert. Vesentlige endringer varsles synlig på nettsiden.</P>
          </Section>

        </div>

        {/* Footer nav */}
        <div style={{ marginTop: '4rem', paddingTop: '2rem', borderTop: '1px solid #2a2d38', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <a href="/vilkar" style={{ color: '#c9a84c', fontSize: '0.9rem', textDecoration: 'none' }}>Brukervilkår →</a>
          <a href="/" style={{ color: '#4a4d5a', fontSize: '0.9rem', textDecoration: 'none' }}>← Tilbake til forsiden</a>
        </div>

      </div>
    </main>
  )
}

// --- Hjelpere ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: '20px', padding: '2rem' }}>
      <h2 className="section-title" style={{ color: '#e8e0d0', fontSize: '1.15rem', fontWeight: 700, marginBottom: '1.25rem' }}>
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {children}
      </div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: '#8a8d9a', fontSize: '0.95rem', lineHeight: 1.75 }}>{children}</p>
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: '10px', padding: '1rem 1.25rem', color: '#8a8d9a', fontSize: '0.9rem', lineHeight: 1.8 }}>
      {children}
    </div>
  )
}

function Table({ rows, headers }: { rows: string[][]; headers?: string[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        {headers && (
          <thead>
            <tr>
              {headers.map(h => (
                <th key={h} style={{ textAlign: 'left', color: '#c9a84c', fontWeight: 600, padding: '0.5rem 0.75rem', borderBottom: '1px solid #2a2d38', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: i < rows.length - 1 ? '1px solid #2a2d38' : 'none' }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '0.625rem 0.75rem', color: j === 0 ? '#e8e0d0' : '#8a8d9a', verticalAlign: 'top' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
