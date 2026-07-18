'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import PasswordInput from '@/components/PasswordInput'

// Siden brukeren lander på etter å ha klikket «sett passord»-lenken i e-posten.
//
// På dette tidspunktet er brukeren ALLEREDE autentisert: /auth/callback har byttet
// koden fra lenken mot en ekte sesjon og skrevet den i cookies. Derfor kan vi kalle
// updateUser({ password }) direkte — ingen gammelt passord kreves, og brukeren har
// aldri måttet innom Google eller magic link.
//
// Samme visuelle mønster som /login (samme panel, samme farger).

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

  .sp-screen {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
  }

  .sp-panel {
    width: 100%;
    max-width: 380px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 40px 32px;
  }

  .sp-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    text-align: center;
    margin-bottom: 8px;
  }

  .sp-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--white);
    text-align: center;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }

  .sp-title em { font-style: italic; color: var(--gold); }

  .sp-sub {
    font-size: 13px;
    color: var(--muted);
    text-align: center;
    margin-bottom: 32px;
  }

  .sp-rule {
    width: 100%;
    height: 1px;
    background: var(--border);
    margin-bottom: 28px;
  }

  .sp-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    display: block;
    margin-bottom: 8px;
  }

  .sp-input {
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

  .sp-input::placeholder { color: var(--muted); }
  .sp-input:focus { border-color: var(--gold); }

  /* Samme autofill-nøytralisering som på /login — nettleseren injiserer ellers en
     lys bakgrunn på passordfelt den kjenner igjen. */
  .sp-input:-webkit-autofill,
  .sp-input:-webkit-autofill:hover,
  .sp-input:-webkit-autofill:focus,
  .sp-input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 1000px var(--bg) inset !important;
    -webkit-text-fill-color: var(--white) !important;
    caret-color: var(--white);
    transition: background-color 9999s ease-in-out 0s;
  }
  .sp-input:autofill {
    box-shadow: 0 0 0 1000px var(--bg) inset;
  }

  .sp-hint {
    font-size: 12px;
    color: var(--muted);
    margin: -8px 0 16px;
    line-height: 1.5;
  }

  .sp-error {
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

  .sp-success {
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

  .sp-btn-primary {
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
  .sp-btn-primary:hover { opacity: 0.88; }
  .sp-btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

  .sp-status {
    font-size: 13px;
    color: var(--body);
    text-align: center;
    line-height: 1.6;
  }

  .sp-back {
    display: block;
    text-align: center;
    margin-top: 20px;
    font-size: 13px;
    color: var(--body);
    text-decoration: none;
    transition: color 0.15s;
  }

  .sp-back:hover { color: #ffffff; }
`

// Samme minstekrav som passord-signup på /login. (Supabase selv tillater 6, men vi
// holder på 8 slik at kravet er identisk uansett hvor passordet settes.)
const MIN_LENGTH = 8

type SessionState = 'checking' | 'ready' | 'missing'

export default function SettPassordPage() {
  const [sessionState, setSessionState] = useState<SessionState>('checking')
  const [userId, setUserId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  // Sesjonen kommer fra cookies satt av /auth/callback. Den er normalt på plass med
  // én gang, men vi lytter også på onAuthStateChange i tilfelle klienten fortsatt
  // holder på å lese den inn.
  useEffect(() => {
    let done = false

    supabase.auth.getSession().then(({ data }) => {
      if (done) return
      if (data.session?.user) {
        done = true
        setUserId(data.session.user.id)
        setSessionState('ready')
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (done || !session?.user) return
      done = true
      setUserId(session.user.id)
      setSessionState('ready')
    })

    // Ingen sesjon innen rimelig tid → lenken er utløpt eller allerede brukt.
    const timer = setTimeout(() => {
      if (!done) setSessionState('missing')
    }, 3000)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [])

  const handleSave = async () => {
    if (password.length < MIN_LENGTH) {
      setError(`Passordet må være minst ${MIN_LENGTH} tegn.`)
      return
    }
    if (password !== confirm) {
      setError('Passordene er ikke like.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        console.error('[sett-passord] updateUser feilet:', updateError.message)
        setError('Kunne ikke lagre passordet. Prøv lenken i e-posten på nytt.')
        setLoading(false)
        return
      }

      // Marker profilen slik at /login viser passord-innlogging neste gang.
      // Gjenbruker mark-password-ruten fra passord-signup (service-role upsert —
      // profilraden kan mangle felt vi ikke har lov til å røre fra klienten).
      if (userId) {
        try {
          const res = await fetch('/api/auth/mark-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
          })
          if (!res.ok) {
            console.error('[sett-passord] mark-password feilet:', await res.text().catch(() => ''))
          }
        } catch (e) {
          console.error('[sett-passord] mark-password-kall feilet:', e)
        }
      }

      setSaved(true)
      // Brukeren er nå innlogget med en ekte sesjon — send dem til forsiden.
      setTimeout(() => window.location.assign('/'), 3000)
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="sp-screen">
        <div className="sp-panel">
          <p className="sp-eyebrow">Quizkanonen</p>
          <h1 className="sp-title">Velg <em>passord</em></h1>
          <p className="sp-sub">
            {saved ? 'Alt klart' : 'Sett et passord for kontoen din'}
          </p>
          <div className="sp-rule" />

          {saved ? (
            <>
              <p className="sp-success">
                Passord satt!<br />
                Du kan nå logge inn med e-post og passord.
              </p>
              <p className="sp-status">Sender deg til forsiden...</p>
            </>
          ) : sessionState === 'checking' ? (
            <p className="sp-status">Sjekker lenken...</p>
          ) : sessionState === 'missing' ? (
            <>
              <p className="sp-error">
                Lenken er utløpt eller allerede brukt.
              </p>
              <p className="sp-status">
                Gå tilbake til innlogging og be om en ny lenke.
              </p>
            </>
          ) : (
            <>
              <label className="sp-label">Nytt passord</label>
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder={`Minst ${MIN_LENGTH} tegn`}
                className="sp-input"
                autoComplete="new-password"
              />

              <label className="sp-label">Bekreft passord</label>
              <PasswordInput
                value={confirm}
                onChange={setConfirm}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) handleSave() }}
                placeholder="Gjenta passordet"
                className="sp-input"
                autoComplete="new-password"
              />

              <p className="sp-hint">Velg et passord på minst {MIN_LENGTH} tegn.</p>
              {error && <p className="sp-error">{error}</p>}

              <button
                onClick={handleSave}
                disabled={loading || password.length < MIN_LENGTH || !confirm}
                className="sp-btn-primary"
              >
                {loading ? 'Lagrer...' : 'Lagre passord'}
              </button>
            </>
          )}

          <Link href={saved ? '/' : '/login'} className="sp-back">
            {saved ? '← Til forsiden' : '← Til innlogging'}
          </Link>
        </div>
      </div>
    </>
  )
}
