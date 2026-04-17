'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { signInWithGoogle } from '@/lib/auth'
import Link from 'next/link'

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
    margin-bottom: 20px;
  }

  .login-input::placeholder { color: var(--muted); }
  .login-input:focus { border-color: var(--gold); }

  .login-error {
    font-size: 13px;
    color: #f87171;
    text-align: center;
    margin-bottom: 16px;
    padding: 10px;
    background: rgba(248,113,113,0.08);
    border: 1px solid rgba(248,113,113,0.18);
    border-radius: var(--radius-btn);
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

  .login-btn {
    width: 100%;
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 11px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .login-btn:hover { background: #d9b85c; }
  .login-btn:disabled { opacity: 0.35; cursor: not-allowed; }

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

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSend = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
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

  return (
    <>
      <style>{STYLES}</style>
      <div className="login-screen">
        <div className="login-panel">
          <p className="login-eyebrow">Quizkanonen</p>
          <h1 className="login-title">Logg <em>inn</em></h1>
          <p className="login-sub">Ingen passord — vi sender deg en innloggingslenke</p>
          <div className="login-rule" />

          <button
            className="login-google-btn"
            onClick={() => {
              const next = new URLSearchParams(window.location.search).get('next') ?? undefined
              signInWithGoogle(next)
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
              <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
              <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
              <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
            </svg>
            Fortsett med Google
          </button>

          <div className="login-separator">eller</div>

          {sent ? (
            <p className="login-success">
              Sjekk innboksen din!<br />
              Vi har sendt en innloggingslenke til <strong>{email}</strong>.
            </p>
          ) : (
            <>
              <label className="login-label">E-postadresse</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="din@epost.no"
                className="login-input"
                autoComplete="email"
              />

              {error && <p className="login-error">{error}</p>}

              <button
                onClick={handleSend}
                disabled={loading || !email.trim()}
                className="login-btn"
              >
                {loading ? 'Sender...' : 'Send innloggingslenke →'}
              </button>
            </>
          )}

          <Link href="/" className="login-back">← Tilbake til forsiden</Link>
        </div>
      </div>
    </>
  )
}
