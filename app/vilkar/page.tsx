export default function Vilkar() {
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
            Brukervilkår
          </h1>
          <p style={{ color: '#8a8d9a', fontSize: '1.05rem', lineHeight: 1.7 }}>
            Ved å bruke Quizkanonen godtar du disse vilkårene. Les dem gjerne — de er skrevet for å være forståelige, ikke for å forvirre.
          </p>
        </div>

        {/* Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

          <Section title="1. Hvem vi er">
            <P>Quizkanonen er en norsk quiz-plattform drevet av:</P>
            <Box>
              <strong style={{ color: '#e8e0d0' }}>[Dennis Busk]</strong><br />
              [Slåtteveien 12], [1084 Oslo]<br />
              E-post: <a href="mailto:[quizkanonen@gmail.com]" style={{ color: '#c9a84c' }}>[din@epost.no]</a>
            </Box>
            <P>Tjenesten er tilgjengelig på <a href="https://quizkanonen.no" style={{ color: '#c9a84c' }}>quizkanonen.no</a>.</P>
          </Section>

          <Section title="2. Hvem vilkårene gjelder for">
            <P>Disse vilkårene gjelder for alle som bruker Quizkanonen — enten du spiller gratis, bruker en verdikode, eller er betalende abonnent. Ved å delta i en quiz bekrefter du at du har lest og godtar vilkårene.</P>
            <P>Du må være minst 13 år for å bruke tjenesten. Ved å bekrefte alderskravet ved quiz-start forsikrer du at dette stemmer.</P>
          </Section>

          <Section title="3. Hva tjenesten er">
            <P>Quizkanonen er en digital quiz-plattform der du kan:</P>
            <ul style={{ color: '#8a8d9a', lineHeight: 1.8, paddingLeft: '1.5rem', fontSize: '0.95rem' }}>
              <li style={{ marginBottom: '0.5rem' }}>Delta i ukentlige quizer gratis</li>
              <li style={{ marginBottom: '0.5rem' }}>Konkurrere mot andre spillere og lag på leaderboard</li>
              <li>Få tilgang til utvidet innhold og funksjoner som premiumbruker</li>
            </ul>
            <P>Vi forbeholder oss retten til å endre, legge til eller fjerne funksjoner uten varsel, så lenge kjernetjenesten opprettholdes.</P>
          </Section>

          <Section title="4. Gratis tilgang">
            <P>Den ukentlige quizen er gratis tilgjengelig for alle. Ingen registrering er nødvendig. Du oppgir et kallenavn eller lagnavn før du starter — dette vises på leaderboard.</P>
            <P>For å hindre dobbeltspilling lagrer vi en enhets-ID i nettleseren din. Du kan kun fullføre samme quiz én gang per enhet. Forsøk på å omgå dette (f.eks. ved å slette nettleserdata og spille igjen) er i strid med rettferdig spill og disse vilkårene.</P>
          </Section>

          <Section title="5. Premium og betaling">
            <P>Quizkanonen tilbyr betalte abonnementer og enkeltpass som gir tilgang til utvidet innhold og funksjoner. Priser og innhold fremgår av betalingssiden til enhver tid.</P>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {[
                ['Betaling', 'Betaling skjer via Stripe (kort). Alle priser er oppgitt i norske kroner inkl. mva.'],
                ['Fornyelse', 'Abonnement fornyes automatisk. Du kan si opp når som helst — tilgangen varer til slutten av betalingsperioden.'],
                ['Oppsigelse', 'Avslutt abonnementet i kontoinnstillingene eller ved å kontakte oss på e-post.'],
                ['Angrerett', '14 dagers angrerett etter kjøpet, med unntak av digitalt innhold du allerede har benyttet deg av (jf. angrerettloven § 22).'],
                ['Refusjon', 'Vi refunderer ikke påbegynte perioder, med mindre det foreligger en teknisk feil på vår side.'],
              ].map(([label, text]) => (
                <div key={label} style={{ display: 'flex', gap: '1rem', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: '10px', padding: '0.875rem 1rem' }}>
                  <span style={{ color: '#c9a84c', fontWeight: 600, fontSize: '0.85rem', minWidth: '120px', flexShrink: 0 }}>{label}</span>
                  <span style={{ color: '#8a8d9a', fontSize: '0.9rem', lineHeight: 1.65 }}>{text}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="6. Verdikoder">
            <P>Verdikoder gir midlertidig tilgang til tjenesten uten betaling. En kode er personlig og kan ikke deles videre. Misbruk av koder (f.eks. distribusjon i offentlige kanaler uten vår tillatelse) kan føre til at tilgangen stenges.</P>
          </Section>

          <Section title="7. Regler for rettferdig spill">
            <P>Quizkanonen er en ferdighetsbasert konkurranse. Følgende er ikke tillatt:</P>
            <ul style={{ color: '#8a8d9a', lineHeight: 1.8, paddingLeft: '1.5rem', fontSize: '0.95rem' }}>
              <li style={{ marginBottom: '0.5rem' }}>Bruke automatiserte verktøy, bots eller scripts for å delta</li>
              <li style={{ marginBottom: '0.5rem' }}>Koordinere svar i sanntid med andre for å få urettferdig fordel</li>
              <li style={{ marginBottom: '0.5rem' }}>Omgå dobbeltspill-sperringen ved å manipulere nettleseren</li>
              <li style={{ marginBottom: '0.5rem' }}>Oppgi kallenavn som er støtende, diskriminerende eller som utgir seg for å være andre</li>
              <li>Forsøke å få tilgang til data som ikke er ment for deg</li>
            </ul>
            <P>Vi forbeholder oss retten til å diskvalifisere spillere og fjerne resultater ved brudd på disse reglene.</P>
          </Section>

          <Section title="8. Innhold og opphavsrett">
            <P>Alt innhold på Quizkanonen — spørsmål, tekst, design og kode — tilhører Quizkanonen eller er lisensiert til oss. Du kan ikke kopiere, gjenbruke eller distribuere innholdet uten skriftlig tillatelse.</P>
            <P>Kallenavnet du oppgir gir deg ingen rettigheter utover å vises på leaderboard for den aktuelle quizen.</P>
          </Section>

          <Section title="9. Ansvarsfraskrivelse">
            <P>Quizkanonen leveres «som den er». Vi garanterer ikke at tjenesten er feilfri, alltid tilgjengelig eller egnet for et bestemt formål. Vi er ikke ansvarlige for tap som oppstår som følge av nedetid, feil eller endringer i tjenesten.</P>
            <P>Premier og belønninger er en frivillig del av tjenesten og kan endres eller avsluttes uten varsel. Vi er ikke forpliktet til å levere spesifikke premier utover det som eksplisitt er lovet i den aktuelle konkurransen.</P>
          </Section>

          <Section title="10. Endringer i vilkårene">
            <P>Vi kan oppdatere disse vilkårene. Datoen øverst på siden viser siste revisjon. Fortsetter du å bruke tjenesten etter at nye vilkår er publisert, anses det som aksept av de oppdaterte vilkårene. Ved vesentlige endringer varsler vi synlig på nettsiden.</P>
          </Section>

          <Section title="11. Lovvalg og tvisteløsning">
            <P>Disse vilkårene er underlagt norsk rett. Eventuelle tvister søkes løst i minnelighet. Kan vi ikke bli enige, hører saken inn under Oslo tingrett som verneting.</P>
            <P>Du kan også klage til <a href="https://www.forbrukertilsynet.no" target="_blank" rel="noopener noreferrer" style={{ color: '#c9a84c' }}>Forbrukertilsynet</a> eller bruke EU-kommisjonens plattform for nettbasert tvisteløsning (ODR) på <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" style={{ color: '#c9a84c' }}>ec.europa.eu/consumers/odr</a>.</P>
          </Section>

          <Section title="12. Kontakt">
            <P>Spørsmål om disse vilkårene? Ta kontakt:</P>
            <Box>
              E-post: <a href="mailto:[quizkanonen@gmail.com]" style={{ color: '#c9a84c' }}>[din@epost.no]</a><br />
              Vi svarer vanligvis innen 2–3 virkedager.
            </Box>
          </Section>

        </div>

        {/* Footer nav */}
        <div style={{ marginTop: '4rem', paddingTop: '2rem', borderTop: '1px solid #2a2d38', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <a href="/personvern" style={{ color: '#c9a84c', fontSize: '0.9rem', textDecoration: 'none' }}>Personvernerklæring →</a>
          <a href="/" style={{ color: '#4a4d5a', fontSize: '0.9rem', textDecoration: 'none' }}>← Tilbake til forsiden</a>
        </div>

      </div>
    </main>
  )
}

// --- Hjelpere (samme som personvern) ---

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