'use client'
import Link from 'next/link'
import AuthForm from '@/components/AuthForm'

// Kun rammen: panel, overskrift og tilbake-lenke. Selve innloggingen bor i
// AuthForm, som deles med AuthModal (toppnav m.fl.). Legg endringer i
// innloggingen der, ikke her — de to var tidligere separate implementasjoner
// som drev fra hverandre.

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
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
    font-family: 'Libre Baskerville', serif;
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
    color: #7a7873;
    text-align: center;
    margin-bottom: 32px;
  }

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
  return (
    <>
      <style>{STYLES}</style>
      <div className="login-screen">
        <div className="login-panel">
          <p className="login-eyebrow">Quizkanonen</p>
          <h1 className="login-title">Logg <em>inn</em></h1>
          <p className="login-sub">Logg inn, eller opprett en konto</p>
          <div className="login-rule" />

          <AuthForm variant="page" />

          <Link href="/" className="login-back">← Tilbake til forsiden</Link>
        </div>
      </div>
    </>
  )
}
