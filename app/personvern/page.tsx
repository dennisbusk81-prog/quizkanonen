export default function Personvern() {
  return (
    <main className="min-h-screen bg-gray-950 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <a href="/" className="text-gray-400 hover:text-white text-sm mb-6 inline-block">← Tilbake</a>
        <h1 className="text-3xl font-black text-white mb-2">Personvernerklæring</h1>
        <p className="text-gray-400 text-sm mb-8">Sist oppdatert: mars 2026</p>

        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-white font-bold text-lg mb-2">Behandlingsansvarlig</h2>
            <p>Quizkanonen drives av [ditt navn/firma], [adresse]. Kontakt oss på <a href="mailto:[din@epost.no]" className="text-yellow-400 hover:underline">[din@epost.no]</a>.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Hvilke data vi samler inn</h2>
            <ul className="list-disc list-inside space-y-1 text-gray-300">
              <li>Visningsnavn du oppgir når du spiller</li>
              <li>Spillresultater og svartider</li>
              <li>En anonym enhets-ID lagret lokalt på din enhet (hindrer dobbeltspilling)</li>
              <li>E-postadresse (kun hvis du oppretter konto)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Hvorfor vi samler inn data</h2>
            <ul className="list-disc list-inside space-y-1 text-gray-300">
              <li>For å vise resultater og leaderboard</li>
              <li>For å hindre at samme enhet spiller samme quiz flere ganger</li>
              <li>For å sende quizrelaterte varsler (kun med ditt samtykke)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Lagring og sikkerhet</h2>
            <p>Data lagres hos Supabase (Frankfurt, Tyskland) og behandles i henhold til GDPR. Vi har databehandleravtale med alle underleverandører.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Dine rettigheter</h2>
            <p>Du har rett til innsyn, retting og sletting av dine data. Send e-post til <a href="mailto:[din@epost.no]" className="text-yellow-400 hover:underline">[din@epost.no]</a> for å utøve disse rettighetene. Vi svarer innen 30 dager.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Aldersgrense</h2>
            <p>Tjenesten er ikke rettet mot personer under 13 år. Vi samler ikke bevisst inn data fra barn under 13 år.</p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-2">Informasjonskapsler og lokal lagring</h2>
            <p>Vi bruker lokal lagring (localStorage) i nettleseren din for å huske at du har spilt en quiz og for å lagre fremgang. Dette er nødvendig for at tjenesten skal fungere, og ingen data sendes til tredjeparter.</p>
          </section>
        </div>
      </div>
    </main>
  )
}