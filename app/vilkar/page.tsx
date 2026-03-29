export default function Vilkar() {
  return (
    <main className="min-h-screen bg-gray-950 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <a href="/" className="text-gray-400 hover:text-white text-sm mb-6 inline-block">← Tilbake</a>
        <h1 className="text-3xl font-black text-white mb-2">Brukervilkår</h1>
        <p className="text-gray-400 text-sm mb-8">Sist oppdatert: mars 2026</p>

        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-white font-bold text-lg mb-2">Aksept av vilkår</h2>
            <p>Ved å bruke Quizkanonen aksepterer du disse vilkårene. Tjenesten er ikke tilgjengelig for personer under 13 år.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Bruk av tjenesten</h2>
            <p>Quizkanonen er en underholdningstjeneste. Du forplikter deg til å ikke:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Misbruke tjenesten eller forsøke å manipulere resultater</li>
              <li>Omgå tekniske sperringer (f.eks. dobbeltspilling)</li>
              <li>Bruke automatiserte verktøy eller roboter</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Innhold</h2>
            <p>Vi forbeholder oss retten til å endre, fjerne eller stenge quizer uten varsel. Quizinnhold er kun for underholdningsformål — vi garanterer ikke at alle svar er korrekte.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Premier og konkurranser</h2>
            <p>Premier tildeles basert på ferdighet (flest riktige svar, raskest tid). Vi forbeholder oss retten til å diskvalifisere deltakere som mistenkes for juks. Premier kan ikke veksles inn i kontanter.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Betalinger</h2>
            <p>Betalingsinformasjon håndteres av Stripe og lagres aldri hos oss. Abonnementer fornyes automatisk og kan sies opp når som helst.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Ansvarsbegrensning</h2>
            <p>Quizkanonen tilbys "som det er". Vi er ikke ansvarlige for tap som følge av feil, nedetid eller unøyaktigheter i quizinnhold.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Endringer i vilkårene</h2>
            <p>Vi kan endre disse vilkårene. Vesentlige endringer varsles via e-post til registrerte brukere med minst 14 dagers varsel.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Gjeldende lov</h2>
            <p>Disse vilkårene er underlagt norsk lov. Tvister løses ved Oslo tingrett.</p>
          </section>
        </div>
      </div>
    </main>
  )
}