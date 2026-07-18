'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { signInWithGoogle, signInWithPassword, signUpWithPassword } from '@/lib/auth'
import Link from 'next/link'
import InAppBrowserWarning from '@/components/InAppBrowserWarning'

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #1a1c23;
    --card:     #21242e;
    --border:   #2a2d38;
    --gold:     #c9a84c;
    --white:    #ffffff;
    --body:     #e8e4dd;
    --muted:    #7a7873;
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .login-screen {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
  }

  .login-panel {
    width: 100%;
    max-width: 380px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 40px 32px;
  }

  .login-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    text-align: center;
    margin-bottom: 8px;
  }

  .login-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--white);
    text-align: center;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }

  .login-title em { font-style: italic; color: var(--gold); }

  .login-sub {
    font-size: 13px;
    color: var(--muted);
    text-align: center;
    margin-bottom: 32px;
  }

  .login-rule {
    width: 100%;
    height: 1px;
    background: var(--border);
    margin-bottom: 28px;
  }

  .login-separator {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 20px 0;
    font-size: 12px;
    color: var(--muted);
    font-family: 'Instrument Sans', sans-serif;
  }
  .login-separator::before,
  .login-separator::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .login-google-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: #ffffff;
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 13px 20px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s;
  }
  .login-google-btn:hover {
    background: #f0f0f0;
    transform: translateY(-1px);
  }

  .login-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    display: block;
    margin-bottom: 8px;
  }

  .login-input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-btn);
    padding: 12px 16px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    color: var(--white);
    outline: none;
    transition: border-color 0.15s;
    margin-bottom: 16px;
  }

  .login-input::placeholder { color: var(--muted); }
  .login-input:focus { border-color: var(--gold); }

  /* Nøytraliser nettlesers autofill-styling (Chrome/Edge/Safari injiserer en lys
     bakgrunn på felt de kjenner igjen, typisk passord — det er derfor ett felt kan
     se lyst ut mens det andre er mørkt selv om begge deler samme CSS-klasse). */
  .login-input:-webkit-autofill,
  .login-input:-webkit-autofill:hover,
  .login-input:-webkit-autofill:focus,
  .login-input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 1000px var(--bg) inset !important;
    -webkit-text-fill-color: var(--white) !important;
    caret-color: var(--white);
    transition: background-color 9999s ease-in-out 0s;
  }
  .login-input:autofill {
    box-shadow: 0 0 0 1000px var(--bg) inset;
  }

  .login-hint {
    font-size: 12px;
    color: var(--muted);
    margin: -8px 0 16px;
    line-height: 1.5;
  }

  .login-error {
    font-size: 13px;
    color: #f87171;
    text-align: center;
    margin-bottom: 16px;
    padding: 10px;
    background: rgba(248,113,113,0.08);
    border: 1px solid rgba(248,113,113,0.18);
    border-radius: var(--radius-btn);
    line-height: 1.5;
  }

  .login-success {
    font-size: 13px;
    color: #4ade80;
    text-align: center;
    margin-bottom: 16px;
    padding: 14px;
    background: rgba(74,222,128,0.08);
    border: 1px solid rgba(74,222,128,0.18);
    border-radius: var(--radius-btn);
    line-height: 1.5;
  }

  /* Passord er primærmetoden — gull fylt, samme mønster som andre primærknapper
     i appen. Google og magic link forblir fullverdige alternativer, men som
     outline-knapper (ikke gull) — kun étt gult element per skjerm. */
  .login-btn-primary {
    width: 100%;
    background: var(--gold);
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 700;
    padding: 10px 28px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
    margin-bottom: 12px;
  }
  .login-btn-primary:hover { opacity: 0.88; }
  .login-btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

  .login-btn-outline {
    width: 100%;
    background: transparent;
    color: var(--body);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 11px;
    border-radius: var(--radius-btn);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: border-color 0.15s;
    margin-bottom: 12px;
  }
  .login-btn-outline:hover { border-color: rgba(201,168,76,0.5); }
  .login-btn-outline:disabled { opacity: 0.4; cursor: not-allowed; }

  .login-switch {
    text-align: center;
    font-size: 13px;
    color: var(--muted);
    margin-top: 8px;
  }
  .login-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--body);
    cursor: pointer;
    text-decoration: underline;
  }

  .login-back {
    display: block;
    text-align: center;
    margin-top: 20px;
    font-size: 13px;
    color: var(--body);
    text-decoration: none;
    transition: color 0.15s;
  }

  .login-back:hover { color: #ffffff; }
`

// Identifier-first: brukeren oppgir e-post først (STEG A), deretter viser vi kun de
// innloggingsmetodene som faktisk gjelder den e-posten (STEG B), basert på svaret
// fra /api/auth/check-email.
type Step = 'email' | 'method'
type CheckResult = { exists: boolean; hasPassword: boolean; hasGoogle: boolean }

// Kun tillat interne redirect-mål (leading slash) for å unngå open redirect.
function safeNext(): string {
  const raw = new URLSearchParams(window.location.search).get('next')
  return raw && raw.startsWith('/') ? raw : '/'
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>('email')
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)          // magic link sendt
  const [signupSent, setSignupSent] = useState(false) // bekreftelsesmail sendt
  const [resetSent, setResetSent] = useState(false)   // «sett passord»-lenke sendt
  const [loading, setLoading] = useState(false)

  const validEmail = /\S+@\S+\.\S+/.test(email.trim())

  const backToEmail = () => {
    setStep('email'); setCheck(null); setPassword(''); setError(''); setResetSent(false)
  }

  // ── STEG A: slå opp e-posten og bestem hvilke metoder som skal vises ──────
  const handleContinue = async () => {
    if (!validEmail) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), phase: 'lookup' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        setError('Kunne ikke sjekke e-posten. Prøv igjen.')
        setLoading(false)
        return
      }
      setCheck({
        exists: data.exists === true,
        hasPassword: data.hasPassword === true,
        hasGoogle: data.hasGoogle === true,
      })
      setStep('method')
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  // ── Magic link ──────────────────────────────────────────────────────────
  const handleMagicLink = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      const next = safeNext()
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`,
        },
      })
      if (error) {
        setError('Noe gikk galt. Sjekk at e-postadressen er riktig og prøv igjen.')
      } else {
        setSent(true)
      }
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  // ── Sett passord for FØRSTE gang (konto finnes, men uten passord) ─────────
  //
  // Bruker Supabase sin innebygde recovery-flyt. Den heter «reset», men gjør i
  // praksis det samme her: sender en e-postbekreftet lenke som gir en ekte sesjon,
  // og på /sett-passord kalles updateUser({ password }). Poenget er at brukeren
  // IKKE må komme seg inn med Google eller magic link først — e-posten alene holder.
  // Kritisk for brukere som sitter fast i en in-app-browser der Google ikke virker.
  //
  // redirectTo peker på /auth/callback (som bytter koden mot en sesjon-cookie,
  // samme sti som magic link) med next=/sett-passord.
  const handleSetPassword = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/sett-passord')}`,
      })
      if (error) {
        console.error('[login] resetPasswordForEmail feilet:', error.message)
        setError('Kunne ikke sende lenken. Sjekk at e-postadressen er riktig og prøv igjen.')
      } else {
        setResetSent(true)
      }
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  // ── Passord-innlogging ──────────────────────────────────────────────────
  const handlePasswordLogin = async () => {
    if (!email.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const { error } = await signInWithPassword(email.trim(), password)
      if (error) {
        if (error.message?.toLowerCase().includes('not confirmed')) {
          setError('E-posten er ikke bekreftet ennå. Sjekk innboksen for bekreftelseslenken.')
        } else {
          setError('Feil e-post eller passord.')
        }
      } else {
        window.location.assign(safeNext())
      }
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  // ── Passord-signup (med eksplisitt duplikat-sperre) ───────────────────────
  const handlePasswordSignup = async () => {
    const cleanEmail = email.trim()
    if (!cleanEmail || password.length < 8) return
    setLoading(true)
    setError('')
    try {
      // Steg 2: eksplisitt server-side sjekk om e-posten allerede finnes i auth.users,
      // FØR vi sender noe signup-forsøk til Supabase.
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, phase: 'pre-signup' }),
      })
      const checkData = await checkRes.json().catch(() => ({}))
      if (!checkRes.ok) {
        setError('Kunne ikke verifisere e-posten. Prøv igjen.')
        setLoading(false)
        return
      }
      if (checkData.exists) {
        setError('Denne e-posten er allerede registrert. Logg inn med Google eller magic link i stedet, eller legg til passord fra profilsiden etter du er innlogget.')
        setLoading(false)
        return
      }

      const next = safeNext()
      const { data, error } = await signUpWithPassword(cleanEmail, password, next !== '/' ? next : undefined)
      if (error) {
        setError('Kunne ikke opprette konto. Prøv igjen.')
        setLoading(false)
        return
      }

      // Steg 3: verifiser i server-loggen at signup ga nøyaktig én auth-bruker for
      // e-posten (ingen duplikat-id). Fire-and-forget — blokkerer ikke UI-en.
      fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, phase: 'post-signup' }),
      }).catch(() => { /* kun logging — ikke kritisk */ })
      console.log('[login] passord-signup ok, ny auth.users.id:', data.user?.id)

      // DEL 1: marker at brukeren nå har satt et passord. Server-side upsert fordi
      // det ikke finnes sesjon/profilrad ennå. Awaited (men ikke fatal) slik at
      // has_password er lagret før brukeren senere kommer tilbake og logger inn.
      if (data.user?.id) {
        try {
          const markRes = await fetch('/api/auth/mark-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: data.user.id }),
          })
          if (!markRes.ok) {
            console.error('[login] mark-password feilet:', await markRes.text().catch(() => ''))
          }
        } catch (e) {
          console.error('[login] mark-password-kall feilet:', e)
        }
      }

      setSignupSent(true)
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  // I STEG B er e-posten låst (readOnly) — endres via "← Bruk en annen e-post".
  const renderEmailInput = (readOnly: boolean) => (
    <>
      <label className="login-label">E-postadresse</label>
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !loading && !readOnly && validEmail) handleContinue() }}
        placeholder="din@epost.no"
        className="login-input"
        autoComplete="email"
        readOnly={readOnly}
      />
    </>
  )

  const renderPasswordInput = (isSignup: boolean) => (
    <>
      <label className="login-label">Passord</label>
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !loading) {
            isSignup ? handlePasswordSignup() : handlePasswordLogin()
          }
        }}
        placeholder={isSignup ? 'Minst 8 tegn' : 'Passord'}
        className="login-input"
        autoComplete={isSignup ? 'new-password' : 'current-password'}
      />
    </>
  )

  const googleSvg = (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
      <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
      <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
      <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
    </svg>
  )

  const googleButton = (
    <button
      className="login-google-btn"
      onClick={() => signInWithGoogle(safeNext() !== '/' ? safeNext() : undefined)}
    >
      {googleSvg}
      Fortsett med Google
    </button>
  )

  const isSignup = check?.exists === false

  return (
    <>
      <style>{STYLES}</style>
      <div className="login-screen">
        <div className="login-panel">
          <p className="login-eyebrow">Quizkanonen</p>
          <h1 className="login-title">
            {step === 'method' && isSignup ? <>Opprett <em>konto</em></> : <>Logg <em>inn</em></>}
          </h1>
          <p className="login-sub">
            {step === 'email'
              ? 'Skriv inn e-posten din for å fortsette'
              : isSignup
                ? 'Opprett en konto for å komme i gang'
                : 'Velg hvordan du vil logge inn'}
          </p>
          <div className="login-rule" />

          <InAppBrowserWarning />

          {sent ? (
            <p className="login-success">
              Sjekk innboksen din!<br />
              Vi har sendt en innloggingslenke til <strong>{email}</strong>.
            </p>
          ) : resetSent ? (
            <p className="login-success">
              Sjekk innboksen din!<br />
              Vi har sendt en lenke til <strong>{email}</strong>. Klikk den for å velge passord.
            </p>
          ) : signupSent ? (
            <p className="login-success">
              Nesten i mål!<br />
              Vi har sendt en bekreftelseslenke til <strong>{email}</strong>. Klikk den for å fullføre registreringen.
            </p>
          ) : step === 'email' ? (
            /* ── STEG A: kun e-post + Fortsett ── */
            <>
              {renderEmailInput(false)}
              {error && <p className="login-error">{error}</p>}
              <button
                onClick={handleContinue}
                disabled={loading || !validEmail}
                className="login-btn-primary"
              >
                {loading ? 'Sjekker...' : 'Fortsett'}
              </button>
            </>
          ) : (
            /* ── STEG B: metoder tilpasset e-posten ── */
            <>
              {renderEmailInput(true)}

              {isSignup ? (
                /* Ny bruker: passord-signup (primær) + Google (alternativ) */
                <>
                  {renderPasswordInput(true)}
                  <p className="login-hint">Velg et passord på minst 8 tegn.</p>
                  {error && <p className="login-error">{error}</p>}
                  <button
                    onClick={handlePasswordSignup}
                    disabled={loading || password.length < 8}
                    className="login-btn-primary"
                  >
                    {loading ? 'Oppretter...' : 'Opprett konto'}
                  </button>
                  <div className="login-separator">eller</div>
                  {googleButton}
                </>
              ) : check?.hasPassword ? (
                /* Eksisterende passord-bruker: passord-innlogging (primær) */
                <>
                  {renderPasswordInput(false)}
                  {error && <p className="login-error">{error}</p>}
                  <button
                    onClick={handlePasswordLogin}
                    disabled={loading || !password}
                    className="login-btn-primary"
                  >
                    {loading ? 'Logger inn...' : 'Logg inn med passord'}
                  </button>
                  <p className="login-switch">
                    <button className="login-link" onClick={handleMagicLink} disabled={loading}>
                      Bruk innloggingslenke i stedet
                    </button>
                  </p>
                </>
              ) : (
                /* Eksisterende bruker uten passord: sett passord (primær),
                   Google og magic link beholdes som alternativer under. */
                <>
                  <p className="login-hint">
                    Du har ikke satt passord ennå. Vi sender deg en lenke på e-post så du kan
                    velge et passord — da slipper du å være avhengig av Google.
                  </p>
                  {error && <p className="login-error">{error}</p>}
                  <button
                    onClick={handleSetPassword}
                    disabled={loading || !email.trim()}
                    className="login-btn-primary"
                  >
                    {loading ? 'Sender...' : 'Sett passord for denne kontoen'}
                  </button>
                  <div className="login-separator">eller logg inn slik</div>
                  {check?.hasGoogle && (
                    <>
                      {googleButton}
                      <div style={{ height: 12 }} />
                    </>
                  )}
                  <button
                    onClick={handleMagicLink}
                    disabled={loading || !email.trim()}
                    className="login-btn-outline"
                  >
                    {loading ? 'Sender...' : 'Få tilsendt innloggingslenke på e-post'}
                  </button>
                </>
              )}

              <p className="login-switch">
                <button className="login-link" onClick={backToEmail}>← Bruk en annen e-post</button>
              </p>
            </>
          )}

          <Link href="/" className="login-back">← Tilbake til forsiden</Link>
        </div>
      </div>
    </>
  )
}
