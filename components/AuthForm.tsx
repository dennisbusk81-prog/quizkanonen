'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { signInWithGoogle, signInWithPassword, signUpWithPassword } from '@/lib/auth'
import InAppBrowserWarning from '@/components/InAppBrowserWarning'
import PasswordInput from '@/components/PasswordInput'
import { sendLinkErrorMessage, linkErrorMessage } from '@/lib/auth-messages'

// DELT innloggingsskjema — brukt av BÅDE /login og AuthModal (toppnav m.fl.).
//
// Erstattet identifier-first-mønsteret 20. juli 2026. Tidligere måtte brukeren
// oppgi e-post og trykke «Fortsett» før siden avslørte hvilke metoder som gjaldt
// kontoen; nå vises e-post + passord + Google samtidig, slik folk forventer.
// Magic link er flyttet ned som fallback bak «Glemt passord?»-lenken.
//
// Før dette var modalen og /login to helt ulike flyter: modalen hadde ikke
// passordfelt i det hele tatt, så en bruker som hadde satt passord kunne ikke
// bruke det fra toppnavigasjonen. Alt bor nå ett sted nettopp for å hindre at de
// to driver fra hverandre igjen.
//
// /api/auth/check-email har fortsatt tre faser, men «lookup» har byttet rolle:
// den bestemmer ikke lenger HVA som vises, den forklarer HVORFOR en innlogging
// feilet (se diagnoseLoginFailure). pre-signup/post-signup — duplikat-sperren —
// er uendret.

type Props = {
  /** Redirect-mål etter innlogging. Utelatt → leses fra ?next= i URL-en. */
  next?: string
  /** Kalles ved vellykket passordinnlogging. Utelatt → naviger til next. */
  onSuccess?: () => void
  /** Kun kosmetisk: modalen er litt tettere enn siden. */
  variant?: 'page' | 'modal'
}

type Mode = 'login' | 'signup'
type Sent = null | 'magic' | 'reset' | 'signup'
type Notice = { text: string; action?: { label: string; onClick: () => void } } | null

// Kun interne redirect-mål (leading slash) — hindrer open redirect.
function safeNext(): string {
  const raw = new URLSearchParams(window.location.search).get('next')
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

export default function AuthForm({ next, onSuccess, variant = 'page' }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [sent, setSent] = useState<Sent>(null)
  const [loading, setLoading] = useState(false)
  const [showFallback, setShowFallback] = useState(false)
  const [linkError, setLinkError] = useState('')

  // Les ?error= én gang, vis forklaringen, og fjern parameteren fra URL-en så en
  // refresh ikke gjentar en feil som allerede er lest.
  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('error')
    if (!code) return
    setLinkError(linkErrorMessage(code))
    url.searchParams.delete('error')
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
  }, [])

  const cleanEmail = email.trim()
  const validEmail = /\S+@\S+\.\S+/.test(cleanEmail)
  const resolvedNext = () => next ?? safeNext()

  const callbackUrl = (target?: string) => {
    const n = target ?? resolvedNext()
    return `${window.location.origin}/auth/callback${n && n !== '/' ? `?next=${encodeURIComponent(n)}` : ''}`
  }

  const switchMode = (m: Mode) => {
    setMode(m); setNotice(null); setShowFallback(false)
  }

  // ── Hvorfor feilet passordinnloggingen? ───────────────────────────────────
  //
  // Supabase svarer «Invalid login credentials» både på feil passord OG på en
  // konto som aldri har hatt passord (typisk Google-brukere). I identifier-first
  // kunne det siste ikke skje — passordfeltet var skjult for slike kontoer. Nå er
  // feltet alltid synlig, så vi må skille de to, ellers får en Google-bruker
  // beskjed om at passordet er feil når sannheten er at det ikke finnes noe.
  const diagnoseLoginFailure = async () => {
    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, phase: 'lookup' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        setNotice({ text: 'Feil e-post eller passord.' })
        return
      }

      // Ingen konto → tilby å opprette en med passordet brukeren allerede skrev.
      // Vi oppretter ALDRI automatisk: en skrivefeil i e-posten skal gi en
      // feilmelding, ikke en ny konto.
      if (!data.exists) {
        setMode('signup')
        setShowFallback(false)
        setNotice({
          text: 'Vi fant ingen konto med denne e-posten. Vil du opprette en? Passordet du skrev inn blir passordet ditt.',
        })
        return
      }

      // Konto finnes, men uten passord — Google-bruker eller magic link-bruker.
      if (!data.hasPassword) {
        setNotice({
          text: data.hasGoogle
            ? 'Denne kontoen bruker Google-innlogging og har ikke passord ennå. Logg inn med Google under, eller få tilsendt en lenke for å velge et passord.'
            : 'Denne kontoen har ikke passord ennå. Vi kan sende deg en lenke på e-post så du kan velge et.',
          action: { label: 'Sett et passord for denne kontoen', onClick: handleSetPassword },
        })
        return
      }

      setNotice({ text: 'Feil passord. Bruk «Glemt passord?» under feltet hvis du trenger et nytt.' })
    } catch {
      setNotice({ text: 'Feil e-post eller passord.' })
    }
  }

  // ── Passord-innlogging ────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!validEmail || !password) return
    setLoading(true)
    setNotice(null)
    try {
      const { error } = await signInWithPassword(cleanEmail, password)
      if (!error) {
        if (onSuccess) onSuccess()
        else window.location.assign(resolvedNext())
        return
      }
      if (error.message?.toLowerCase().includes('not confirmed')) {
        setNotice({ text: 'E-posten er ikke bekreftet ennå. Sjekk innboksen for bekreftelseslenken.' })
      } else {
        await diagnoseLoginFailure()
      }
    } catch {
      setNotice({ text: 'Noe gikk galt. Prøv igjen.' })
    } finally {
      setLoading(false)
    }
  }

  // ── Passord-signup (med eksplisitt duplikat-sperre) ───────────────────────
  const handleSignup = async () => {
    if (!validEmail || password.length < 8) return
    setLoading(true)
    setNotice(null)
    try {
      // Eksplisitt server-side sjekk om e-posten allerede finnes i auth.users,
      // FØR vi sender noe signup-forsøk til Supabase. Uendret fra før.
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, phase: 'pre-signup' }),
      })
      const checkData = await checkRes.json().catch(() => ({}))
      if (!checkRes.ok) {
        setNotice({ text: 'Kunne ikke verifisere e-posten. Prøv igjen.' })
        setLoading(false)
        return
      }
      if (checkData.exists) {
        setMode('login')
        setNotice({
          text: 'Denne e-posten er allerede registrert. Logg inn med passordet ditt eller Google under.',
        })
        setLoading(false)
        return
      }

      const n = resolvedNext()
      const { data, error } = await signUpWithPassword(cleanEmail, password, n !== '/' ? n : undefined)
      if (error) {
        setNotice({ text: 'Kunne ikke opprette konto. Prøv igjen.' })
        setLoading(false)
        return
      }

      // Verifiser i server-loggen at signup ga nøyaktig én auth-bruker for
      // e-posten (ingen duplikat-id). Fire-and-forget — blokkerer ikke UI-en.
      fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, phase: 'post-signup' }),
      }).catch(() => { /* kun logging — ikke kritisk */ })

      // Marker at brukeren nå har satt et passord. Server-side upsert fordi det
      // ikke finnes sesjon/profilrad ennå. Awaited (men ikke fatal) slik at
      // has_password er lagret før brukeren senere kommer tilbake og logger inn.
      if (data.user?.id) {
        try {
          const markRes = await fetch('/api/auth/mark-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: data.user.id }),
          })
          if (!markRes.ok) {
            console.error('[auth] mark-password feilet:', await markRes.text().catch(() => ''))
          }
        } catch (e) {
          console.error('[auth] mark-password-kall feilet:', e)
        }
      }

      setSent('signup')
    } catch {
      setNotice({ text: 'Noe gikk galt. Prøv igjen.' })
    } finally {
      setLoading(false)
    }
  }

  // ── Fallback 1: lenke for å velge passord ─────────────────────────────────
  //
  // Supabase sin recovery-flyt. Den heter «reset», men dekker begge tilfellene
  // her: glemt passord OG aldri satt passord. Lenken gir en ekte sesjon via
  // /auth/callback, og på /sett-passord kalles updateUser({ password }).
  // Poenget er at brukeren IKKE må inn med Google først — e-posten alene holder.
  // Kritisk for brukere som sitter fast i en in-app-browser der Google ikke virker.
  async function handleSetPassword() {
    if (!validEmail) {
      setNotice({ text: 'Skriv inn e-postadressen din først.' })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/sett-passord')}`,
      })
      if (error) {
        console.error('[auth] resetPasswordForEmail feilet:', error.message)
        setNotice({ text: sendLinkErrorMessage(error) })
      } else {
        setSent('reset')
      }
    } catch {
      setNotice({ text: 'Noe gikk galt. Prøv igjen.' })
    } finally {
      setLoading(false)
    }
  }

  // ── Fallback 2: ren innloggingslenke (magic link) ─────────────────────────
  const handleMagicLink = async () => {
    if (!validEmail) {
      setNotice({ text: 'Skriv inn e-postadressen din først.' })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { emailRedirectTo: callbackUrl() },
      })
      if (error) {
        console.error('[auth] signInWithOtp feilet:', error.message)
        setNotice({ text: sendLinkErrorMessage(error) })
      } else {
        setSent('magic')
      }
    } catch {
      setNotice({ text: 'Noe gikk galt. Prøv igjen.' })
    } finally {
      setLoading(false)
    }
  }

  const isSignup = mode === 'signup'
  const canSubmit = isSignup
    ? validEmail && password.length >= 8
    : validEmail && password.length > 0

  // ── Kvitteringsskjermer ───────────────────────────────────────────────────
  if (sent) {
    const body =
      sent === 'magic'
        ? <>Vi har sendt en innloggingslenke til <strong>{cleanEmail}</strong>.</>
        : sent === 'reset'
          ? <>Vi har sendt en lenke til <strong>{cleanEmail}</strong>. Klikk den for å velge passord.</>
          : <>Vi har sendt en bekreftelseslenke til <strong>{cleanEmail}</strong>. Klikk den for å fullføre registreringen.</>

    return (
      <>
        <style>{STYLES}</style>
        <p className="qk-auth-success">
          {sent === 'signup' ? 'Nesten i mål!' : 'Sjekk innboksen din!'}<br />
          {body}
        </p>
        <p className="qk-auth-switch">
          <button className="qk-auth-link" onClick={() => { setSent(null); setNotice(null) }}>
            ← Tilbake
          </button>
        </p>
      </>
    )
  }

  return (
    <>
      <style>{STYLES}</style>

      <InAppBrowserWarning />

      {/* Forklaring fra ?error=. Vikes for en fersk inline-melding, så brukeren
          aldri ser to motstridende beskjeder samtidig. */}
      {linkError && !notice && <p className="qk-auth-error">{linkError}</p>}

      {notice && (
        <div className="qk-auth-error">
          {notice.text}
          {notice.action && (
            <>
              <br />
              <button
                className="qk-auth-link qk-auth-link-action"
                onClick={notice.action.onClick}
                disabled={loading}
              >
                {notice.action.label}
              </button>
            </>
          )}
        </div>
      )}

      <form
        onSubmit={e => { e.preventDefault(); isSignup ? handleSignup() : handleLogin() }}
        className={variant === 'modal' ? 'qk-auth-form qk-auth-form-modal' : 'qk-auth-form'}
      >
        <label className="qk-auth-label" htmlFor="qk-auth-email">E-postadresse</label>
        <input
          id="qk-auth-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="din@epost.no"
          className="qk-auth-input"
          autoComplete="email"
        />

        <label className="qk-auth-label" htmlFor="qk-auth-password">Passord</label>
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder={isSignup ? 'Minst 8 tegn' : 'Passord'}
          className="qk-auth-input"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          marginBottom={isSignup ? 8 : 4}
        />

        {isSignup ? (
          <p className="qk-auth-hint">Velg et passord på minst 8 tegn.</p>
        ) : (
          <p className="qk-auth-forgot">
            <button
              type="button"
              className="qk-auth-link"
              onClick={() => setShowFallback(v => !v)}
            >
              Glemt passord, eller ikke satt et ennå?
            </button>
          </p>
        )}

        {/* Fallback-panel: e-postlenker. Bevisst plassert bak et klikk — de er
            redningsveier, ikke likestilte hovedvalg. */}
        {showFallback && !isSignup && (
          <div className="qk-auth-fallback">
            <button type="button" className="qk-auth-btn-solid" onClick={handleSetPassword} disabled={loading}>
              {loading ? 'Sender...' : 'Send meg en lenke for å velge passord'}
            </button>
            <button type="button" className="qk-auth-btn-solid" onClick={handleMagicLink} disabled={loading}>
              {loading ? 'Sender...' : 'Send meg en innloggingslenke'}
            </button>
            <p className="qk-auth-hint qk-auth-hint-last">
              Begge lenkene sendes til e-posten du skrev inn over.
            </p>
          </div>
        )}

        <button type="submit" disabled={loading || !canSubmit} className="qk-auth-btn-primary">
          {loading
            ? (isSignup ? 'Oppretter...' : 'Logger inn...')
            : (isSignup ? 'Opprett konto' : 'Logg inn')}
        </button>
      </form>

      <div className="qk-auth-separator">eller</div>

      <button className="qk-auth-google" onClick={() => signInWithGoogle(resolvedNext() !== '/' ? resolvedNext() : undefined)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
          <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
          <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
          <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
        </svg>
        Fortsett med Google
      </button>

      <p className="qk-auth-switch">
        {isSignup ? (
          <>Har du konto fra før?{' '}
            <button className="qk-auth-link" onClick={() => switchMode('login')}>Logg inn</button>
          </>
        ) : (
          <>Ny her?{' '}
            <button className="qk-auth-link" onClick={() => switchMode('signup')}>Opprett konto</button>
          </>
        )}
      </p>

      <p className="qk-auth-terms">
        Ved å logge inn godtar du våre{' '}
        <a href="/vilkar" className="qk-auth-terms-link">vilkår</a>
        {' '}og{' '}
        <a href="/personvern" className="qk-auth-terms-link">personvernerklæringen</a>.
      </p>
    </>
  )
}

// Prefikset qk-auth- fordi stilene er globale (ett <style>-element), og skjemaet
// rendres både på en dedikert side og oppå vilkårlige sider i modalen.
const STYLES = `
  .qk-auth-form { margin: 0; }

  .qk-auth-label {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #7a7873;
    display: block;
    margin-bottom: 8px;
  }

  .qk-auth-input {
    width: 100%;
    background: #1a1c23;
    border: 1px solid #2a2d38;
    border-radius: 10px;
    padding: 12px 16px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    color: #ffffff;
    outline: none;
    transition: border-color 0.15s;
    margin-bottom: 16px;
  }
  .qk-auth-input::placeholder { color: #7a7873; }
  .qk-auth-input:focus { border-color: #c9a84c; }

  /* Nøytraliser nettlesers autofill-styling (Chrome/Edge/Safari injiserer en lys
     bakgrunn på felt de kjenner igjen, typisk passord — det er derfor ett felt kan
     se lyst ut mens det andre er mørkt selv om begge deler samme CSS-klasse). */
  .qk-auth-input:-webkit-autofill,
  .qk-auth-input:-webkit-autofill:hover,
  .qk-auth-input:-webkit-autofill:focus,
  .qk-auth-input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 1000px #1a1c23 inset !important;
    -webkit-text-fill-color: #ffffff !important;
    caret-color: #ffffff;
    transition: background-color 9999s ease-in-out 0s;
  }
  .qk-auth-input:autofill { box-shadow: 0 0 0 1000px #1a1c23 inset; }

  .qk-auth-hint {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 12px;
    color: #7a7873;
    margin: 0 0 16px;
    line-height: 1.5;
  }
  .qk-auth-hint-last { margin-bottom: 0; }

  .qk-auth-forgot {
    text-align: right;
    font-size: 13px;
    margin: 0 0 16px;
  }

  .qk-auth-fallback {
    border: 1px solid #2a2d38;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .qk-auth-error {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    color: #f87171;
    text-align: center;
    margin-bottom: 16px;
    padding: 12px;
    background: rgba(248,113,113,0.08);
    border: 1px solid rgba(248,113,113,0.18);
    border-radius: 10px;
    line-height: 1.5;
  }

  .qk-auth-success {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    color: #4ade80;
    text-align: center;
    margin-bottom: 16px;
    padding: 14px;
    background: rgba(74,222,128,0.08);
    border: 1px solid rgba(74,222,128,0.18);
    border-radius: 10px;
    line-height: 1.5;
  }

  /* Passord er primærmetoden — gull fylt. Google er hvit, e-postlenkene er
     nøytrale. Kun ETT gult element per skjerm (derfor er også vilkårslenkene
     nederst #e8e4dd, ikke gull). */
  .qk-auth-btn-primary {
    width: 100%;
    background: #c9a84c;
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 700;
    padding: 12px 28px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .qk-auth-btn-primary:hover { opacity: 0.88; }
  .qk-auth-btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Solid nøytral knapp — den transparente outline-varianten blir nesten usynlig
     mot kortets egen border for enkelte brukere. */
  .qk-auth-btn-solid {
    width: 100%;
    background: #2a2d38;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 600;
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid rgba(232,228,221,0.16);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    margin-bottom: 10px;
  }
  .qk-auth-btn-solid:hover { background: #323540; border-color: rgba(232,228,221,0.28); }
  .qk-auth-btn-solid:disabled { opacity: 0.4; cursor: not-allowed; }

  .qk-auth-separator {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 20px 0;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 12px;
    color: #7a7873;
  }
  .qk-auth-separator::before,
  .qk-auth-separator::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #2a2d38;
  }

  .qk-auth-google {
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
    border-radius: 10px;
    border: none;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s;
  }
  .qk-auth-google:hover { background: #f0f0f0; transform: translateY(-1px); }

  .qk-auth-switch {
    text-align: center;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    color: #7a7873;
    margin-top: 20px;
  }

  .qk-auth-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: #e8e4dd;
    cursor: pointer;
    text-decoration: underline;
  }
  .qk-auth-link:disabled { opacity: 0.5; cursor: not-allowed; }
  .qk-auth-link-action { margin-top: 8px; display: inline-block; }

  .qk-auth-terms {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 11px;
    color: #7a7873;
    text-align: center;
    margin-top: 16px;
    line-height: 1.6;
  }
  .qk-auth-terms-link { color: #e8e4dd; text-decoration: underline; }
`
