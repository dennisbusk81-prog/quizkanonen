'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AuthModal from '@/components/AuthModal'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const PENDING_KEY = 'qk_pending_action'

const s = {
  page: {
    minHeight: '100vh',
    background: '#1a1c23',
    fontFamily: "'Instrument Sans', sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
  },
  inner: { maxWidth: 440, width: '100%' },
  eyebrow: {
    fontSize: 11, fontWeight: 600, letterSpacing: '0.18em',
    textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 14,
    fontFamily: "'Instrument Sans', sans-serif",
  },
  logo: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(32px, 7vw, 44px)',
    fontWeight: 700, color: '#ffffff',
    lineHeight: 1.08, letterSpacing: '-0.02em', marginBottom: 48,
  },
  logoEm: { fontStyle: 'italic', color: '#c9a84c' },
  card: {
    background: '#21242e',
    border: '1px solid #2a2d38',
    borderRadius: 20,
    padding: '36px 32px',
    textAlign: 'center' as const,
  },
  cardGold: {
    background: '#21242e',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 20,
    padding: '36px 32px',
    textAlign: 'center' as const,
  },
  heading: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(22px, 5vw, 28px)',
    fontWeight: 700, color: '#ffffff',
    letterSpacing: '-0.01em', marginBottom: 10,
  },
  sub: { fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 28 },
  btn: {
    width: '100%', padding: '11px 24px',
    background: '#c9a84c', color: '#0f0f10',
    border: 'none', borderRadius: 10,
    fontSize: 15, fontWeight: 700,
    fontFamily: "'Instrument Sans', sans-serif",
    cursor: 'pointer', transition: 'opacity 0.15s',
  },
  spinner: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 16, color: '#6a6860', fontStyle: 'italic' as const,
    marginBottom: 0,
  },
  error: {
    fontSize: 13, color: '#f87171',
    background: 'rgba(248,113,113,0.08)',
    border: '1px solid rgba(248,113,113,0.18)',
    borderRadius: 10, padding: '10px 14px',
    marginTop: 16, lineHeight: 1.5,
  },
  successIcon: { fontSize: 36, marginBottom: 12 },
} as const

type JoinState = 'checking' | 'not-logged-in' | 'joining' | 'success' | 'error'

export default function BliMedPage() {
  const router = useRouter()
  const rawParams = useParams()
  const token = Array.isArray(rawParams.token) ? rawParams.token[0] : (rawParams.token ?? '')

  const [joinState, setJoinState] = useState<JoinState>('checking')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  async function runJoin(accessToken: string) {
    setJoinState('joining')
    setJoinError(null)
    try {
      const res = await fetch('/api/leagues/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ invite_token: token }),
      })
      const data = await res.json()
      if (res.ok || res.status === 409) {
        // Suksess eller allerede medlem — begge deler sender til ligasiden
        router.replace(`/liga/${data.slug}`)
      } else {
        setJoinError(data.error ?? 'Noe gikk galt. Prøv igjen.')
        setJoinState('error')
      }
    } catch {
      setJoinError('Noe gikk galt. Prøv igjen.')
      setJoinState('error')
    }
  }

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let handled = false

    async function joinWithSession(accessToken: string) {
      if (handled || cancelled) return
      handled = true
      localStorage.removeItem(PENDING_KEY)
      await runJoin(accessToken)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'INITIAL_SESSION') {
        if (session?.access_token) {
          joinWithSession(session.access_token)
        } else {
          if (!handled) setJoinState('not-logged-in')
        }
      } else if (event === 'SIGNED_IN' && session?.access_token) {
        joinWithSession(session.access_token)
      }
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  function handleLoginClick() {
    localStorage.setItem(PENDING_KEY, 'liga_join')
    setModalOpen(true)
  }

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.page}>
        <div style={s.inner}>
          <p style={s.eyebrow}>Den ukentlige quizen</p>
          <h1 style={s.logo}>
            Quiz<em style={s.logoEm}>kanonen</em>
          </h1>

          {joinState === 'checking' || joinState === 'joining' ? (
            <div style={s.card}>
              <p style={s.spinner}>
                {joinState === 'joining' ? 'Melder deg inn i ligaen…' : 'Sjekker invitasjon…'}
              </p>
            </div>
          ) : joinState === 'not-logged-in' ? (
            <div style={s.card}>
              <h2 style={s.heading}>Du er invitert!</h2>
              <p style={s.sub}>
                Logg inn for å bli med i ligaen og konkurrere mot vennene dine på Quizkanonen.
              </p>
              <button
                onClick={handleLoginClick}
                style={s.btn}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                Logg inn for å bli med
              </button>
            </div>
          ) : joinState === 'error' ? (
            <div style={s.card}>
              <h2 style={s.heading}>Noe gikk galt</h2>
              <p style={s.sub}>Invitasjonslenken er kanskje ugyldig eller utløpt.</p>
              {joinError && <div style={s.error}>{joinError}</div>}
              <div style={{ marginTop: 20 }}>
                <a
                  href="/liga"
                  style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}
                >
                  ← Mine ligaer
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <AuthModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        next={`/liga/bli-med/${token}`}
      />
    </>
  )
}
