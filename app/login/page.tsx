'use client'
import { useCallback, useState } from 'react'
import AuthForm, { type AuthView } from '@/components/AuthForm'

// Kun rammen: panel, overskrift og tilbake-lenke. Selve innloggingen bor i
// AuthForm, som deles med AuthModal (toppnav m.fl.). Legg endringer i
// innloggingen der, ikke her — de to var tidligere separate implementasjoner
// som drev fra hverandre.

// UNDERTITTELEN er handlingsetiketten på denne siden — H1-en er det ikke (se
// kommentaren ved <h1>). Fram til nå sto begge stille mens FIRE ting under dem
// skiftet: passordhintet, begge knappene, magic link-blokka og vilkårslinja.
// Skjermen rykket i stedet for å skifte, akkurat som i modalen før 2a9f2bc.
//
// Kvitteringsskjermene har ingen undertittel: AuthForm viser da sin egen grønne
// boks, og FØRSTE LINJE i den er «Sjekk innboksen din!». En undertittel med
// samme beskjed ville stått og gjentatt seg selv to linjer unna. «Logg inn
// eller opprett konto» ville vært verre — en meny over valg brukeren allerede
// har tatt. H1-en over kan ikke lyve, så ingenting blir stående uforklart.
//
// Signup-teksten er ORDRETT den samme som SIGNUP_DESCRIPTION i AuthModal.tsx,
// slik at de to flatene sier det samme. Den er bevisst duplisert i stedet for
// delt: modalens tekster er prod-verifiserte og skulle ikke røres i denne
// runden. lib/login-undertittel.test.ts feller at de to strengene kommer i
// utakt — se kommentaren der før du «rydder» ved å slette den ene.
const UNDERTITLER: Record<AuthView, string | null> = {
  login: 'Logg inn eller opprett konto',
  signup: 'Kontoen er gratis. Resultatene lagres på deg, og poengene teller i sesongen.',
  'sent-magic': null,
  'sent-reset': null,
  'sent-signup': null,
}

const STYLES = `

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #1a1c23;
    font-family: var(--font-instrument-sans), sans-serif;
    color: #e8e4dd;
    min-height: 100vh;
  }

  .login-screen {
    min-height: 100vh;
    background: #1a1c23;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
  }

  .login-panel {
    width: 100%;
    max-width: 380px;
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 20px;
    padding: 40px 32px;
  }

  .login-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #c9a84c;
    text-align: center;
    margin-bottom: 8px;
  }

  .login-title {
    font-family: var(--font-libre-baskerville), serif;
    font-size: 28px;
    font-weight: 700;
    color: #ffffff;
    text-align: center;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }

  .login-title em { font-style: italic; color: #c9a84c; }

  .login-sub {
    font-size: 13px;
    color: #918f8a;
    text-align: center;
    margin-bottom: 32px;
  }

  /* Undertittelen bærer normalt luften ned mot skillelinjen (32 px). På
     kvitteringsskjermene finnes den ikke, og tittelen må overta avstanden —
     ellers klemmes skillelinjen opp mot overskriften. Samme grep som
     marginBottom-vekslingen på <h2> i AuthModal.tsx. */
  .login-title-alene { margin-bottom: 32px; }

  .login-rule {
    width: 100%;
    height: 1px;
    background: #2a2d38;
    margin-bottom: 28px;
  }

  .login-back {
    display: block;
    text-align: center;
    margin-top: 20px;
    font-size: 13px;
    color: #e8e4dd;
    text-decoration: none;
    transition: color 0.15s;
  }

  .login-back:hover { color: #ffffff; }
`

export default function LoginPage() {
  // Skjermen AuthForm faktisk viser. Signalet finnes fra før (2a9f2bc) — dette
  // er samme vei modalen bruker, ikke en ny. Ren VISNING: skjemaet eier
  // fortsatt modusen, siden her leser den bare av.
  const [view, setView] = useState<AuthView>('login')
  const handleViewChange = useCallback((v: AuthView) => setView(v), [])

  const undertittel = UNDERTITLER[view]

  return (
    <>
      <style>{STYLES}</style>
      <div className="login-screen">
        <div className="login-panel">
          <p className="login-eyebrow">Quizkanonen</p>
          {/* H1-EN STÅR URØRT, og skal fortsette å gjøre det: siden nås både fra
              «Bli med» (forsiden) og «Logg inn» (toppnav), og den er en
              DESTINASJONSRAMME, ikke en handlingsetikett — «Bli med i
              Quizkanonen» er sant i begge moduser og kan ikke motsi noen av
              inngangene (N9, 17. august 2026).

              Det er UNDERTITTELEN under som er handlingsetiketten, og det er
              derfor DEN følger modusen. Ikke flytt modus-logikk opp hit. */}
          <h1 className={undertittel ? 'login-title' : 'login-title login-title-alene'}>
            Bli med i <em>Quizkanonen</em>
          </h1>
          {undertittel && <p className="login-sub">{undertittel}</p>}
          <div className="login-rule" />

          <AuthForm variant="page" onViewChange={handleViewChange} />
        </div>
      </div>
    </>
  )
}
