'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
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
    --body:     #9a9590;
    --muted:    #6a6860;
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
    padding: 13px;
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
    color: var(--muted);
    text-decoration: none;
    transition: color 0.15s;
  }

  .login-back:hover { color: var(--body); }

  .login-redirecting {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 8px 0 16px;
  }

  .login-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(201,168,76,0.2);
    border-top-color: #c9a84c;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .login-redirecting-text {
    font-size: 14px;
    color: var(--body);
    text-align: center;
  }
`

function LoginContent() {
  const searchParams = useSearchParams()
  const googleRedirect = searchParams.get('google') === '1'
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (googleRedirect) {
      const redirectTo = encodeURIComponent('https://www.quizkanonen.no/auth/callback')
      window.location.href = `https://nbfyarftteitbjglgfyd.supabase.co/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`
    }
  }, [googleRedirect])

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

          {googleRedirect ? (
            <div className="login-redirecting">
              <div className="login-spinner" />
              <p className="login-redirecting-text">Sender deg til Google…</p>
            </div>
          ) : sent ? (
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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
