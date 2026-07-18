'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AuthModal from '@/components/AuthModal'
import type { Session } from '@supabase/supabase-js'

type FoundersCount = {
  used: number
  max: number
  remaining: number
  isFull: boolean
  daysFree: number
  isFounders: boolean
}

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
  inner: {
    maxWidth: 520,
    width: '100%',
  },
  eyebrow: {
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: '#c9a84c',
    marginBottom: 14,
  },
  logo: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(32px, 7vw, 44px)',
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.08,
    letterSpacing: '-0.02em',
    marginBottom: 32,
  },
  logoEm: {
    fontStyle: 'italic',
    color: '#c9a84c',
  },
  countdownCard: {
    background: '#21242e',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 16,
    padding: 24,
    textAlign: 'center' as const,
    marginBottom: 16,
  },
  countdownLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: '#7a7873',
    marginBottom: 10,
  },
  countdownTitle: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 28,
    fontWeight: 700,
    color: '#ffffff',
    marginBottom: 8,
    lineHeight: 1.15,
  },
  countdownSub: {
    fontSize: 15,
    color: '#e8e4dd',
    marginBottom: 14,
  },
  progressTrack: {
    height: 4,
    background: '#2a2d38',
    borderRadius: 4,
    overflow: 'hidden' as const,
    marginBottom: 8,
  },
  countdownHint: {
    fontSize: 12,
    color: '#7a7873',
  },
  card: {
    background: '#21242e',
    border: '1px solid #2a2d38',
    borderRadius: 16,
    padding: '36px 32px',
  },
  heading: {
    fontFamily: "'Libre Baskerville', serif",
    fontSize: 'clamp(24px, 5vw, 30px)',
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '-0.02em',
    marginBottom: 12,
  },
  ingress: {
    fontFamily: "'Libre Baskerville', serif",
    fontStyle: 'italic',
    fontSize: 16,
    color: '#e8e4dd',
    marginBottom: 28,
    lineHeight: 1.5,
  },
  checkList: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 32px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
  },
  checkItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    fontSize: 15,
    color: '#e8e4dd',
    lineHeight: 1.4,
  },
  checkMark: {
    color: '#c9a84c',
    fontWeight: 700,
    fontSize: 16,
    flexShrink: 0,
    marginTop: 1,
  },
  btn: {
    width: 'auto',
    padding: '10px 28px',
    background: '#c9a84c',
    color: '#1a1c23',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'Instrument Sans', sans-serif",
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  btnDisabled: {
    width: 'auto',
    padding: '10px 28px',
    background: '#2a2d38',
    color: '#7a7873',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'Instrument Sans', sans-serif",
    cursor: 'not-allowed',
    marginBottom: 14,
  },
  alreadyPremium: {
    background: 'rgba(201,168,76,0.08)',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 10,
    padding: '11px 18px',
    color: '#c9a84c',
    fontSize: 14,
    fontWeight: 600,
    textAlign: 'center' as const,
    marginBottom: 14,
  },
  btnSecondary: {
    display: 'block',
    width: '100%',
    padding: '10px 24px',
    background: 'transparent',
    color: '#e8e4dd',
    border: '1px solid #2a2d38',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Instrument Sans', sans-serif",
    cursor: 'pointer',
    textAlign: 'center' as const,
    textDecoration: 'none',
    transition: 'border-color 0.15s, color 0.15s',
    marginBottom: 14,
  },
}

export default function FoundersPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [foundersData, setFoundersData] = useState<FoundersCount | null>(null)

  // Hent live founders-data
  useEffect(() => {
    fetch('/api/founders/count')
      .then(r => r.json())
      .then(setFoundersData)
      .catch(() => {/* bruk null — vis fallback-tekst */})
  }, [])

  async function runActivate(accessToken: string) {
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/stripe/founders-activate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })
      const data = await res.json()
      if (data.success) {
        router.push('/founders/success')
      } else {
        setErrorMsg(data.error ?? 'Noe gikk galt. Prøv igjen.')
      }
    } catch {
      setErrorMsg('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  // Mount: kjør pending action hvis bruker kom tilbake fra OAuth
  useEffect(() => {
    async function checkPending() {
      const pending = localStorage.getItem('qk_pending_action')
      if (pending !== 'founders_checkout') return
      const { data: { session: s } } = await supabase.auth.getSession()
      if (!s?.access_token) return
      localStorage.removeItem('qk_pending_action')
      await runActivate(s.access_token)
    }
    checkPending()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (s?.user) {
        if (s.access_token) {
          fetch('/api/profile/premium-status', {
            headers: { Authorization: `Bearer ${s.access_token}` },
          })
            .then(r => r.ok ? r.json() : { isPremium: false })
            .then(data => setIsPremium(data.isPremium === true))
            .catch(() => { /* fallback: not premium */ })
        }
        if (event === 'SIGNED_IN') {
          const pending = localStorage.getItem('qk_pending_action')
          if (pending === 'founders_checkout' && s.access_token) {
            localStorage.removeItem('qk_pending_action')
            runActivate(s.access_token)
          }
        }
      } else {
        setIsPremium(false)
      }
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleActivate() {
    setLoading(true)
    setErrorMsg(null)
    try {
      let { data: { session: s } } = await supabase.auth.getSession()
      if (!s) {
        await new Promise<void>(resolve => setTimeout(resolve, 500))
        const { data } = await supabase.auth.getSession()
        s = data.session
      }
      if (!s?.access_token) {
        localStorage.setItem('qk_pending_action', 'founders_checkout')
        setLoading(false)
        setModalOpen(true)
        return
      }
      await runActivate(s.access_token)
    } catch {
      setErrorMsg('Noe gikk galt. Prøv igjen.')
      setLoading(false)
    }
  }

  const fd = foundersData
  const daysFree = fd?.daysFree ?? 30
  const isFounders = fd?.isFounders ?? true

  // Founders-tilbudet er forlenget til 15. august 2026 (23:59 Europe/Oslo).
  // Frem til da viser vi konkret sluttdato; etter datoen (eller når tilbudet er
  // fullt) faller vi tilbake til «dager gratis»-teksten — i tråd med fallbacken
  // i /api/stripe/founders-activate.
  const beforeDeadline = Date.now() < new Date('2026-08-15T23:59:00+02:00').getTime()
  const showDeadline = beforeDeadline && isFounders
  const DEADLINE_LABEL = '15. august'

  const btnLabel = loading
    ? 'Aktiverer...'
    : showDeadline
      ? `Aktiver gratis til ${DEADLINE_LABEL} →`
      : isFounders
        ? `Aktiver ${daysFree} dager gratis →`
        : `Start ${daysFree} dager gratis →`

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <a href="/" style={{ color: '#e8e4dd', fontSize: 14, textDecoration: 'none', display: 'inline-block', marginBottom: 24 }}>
          ← Tilbake til forsiden
        </a>
        <p style={s.eyebrow}>Den ukentlige quizen</p>
        <h1 style={s.logo}>
          Quiz<em style={s.logoEm}>kanonen</em>
        </h1>

        {/* Live plass-nedtelling */}
        {fd && (
          <div style={s.countdownCard}>
            <p style={s.countdownLabel}>
              {fd.isFounders ? 'Founders-tilbud' : 'Prøv gratis'}
            </p>
            <p style={s.countdownTitle}>
              {fd.isFounders
                ? `${fd.remaining} av ${fd.max} plasser igjen`
                : `${fd.daysFree} dager gratis`}
            </p>
            <p style={s.countdownSub}>
              {fd.isFounders
                ? (showDeadline
                    ? `Gratis til ${DEADLINE_LABEL} — ingen kortinfo nødvendig`
                    : `${fd.daysFree} dager gratis — ingen kortinfo nødvendig`)
                : 'Ingen kortinfo nødvendig'}
            </p>
            {fd.isFounders && (
              <>
                <div style={s.progressTrack}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (fd.used / fd.max) * 100)}%`,
                    background: '#c9a84c',
                    borderRadius: 4,
                    transition: 'width 0.6s ease',
                  }} />
                </div>
                <p style={s.countdownHint}>{fd.used} har allerede aktivert</p>
              </>
            )}
          </div>
        )}

        <div style={s.card}>
          <h2 style={s.heading}>Founders Access</h2>
          <p style={s.ingress}>Du er blant de første. Det skal lønne seg.</p>

          <ul style={s.checkList}>
            {[
              showDeadline
                ? `Gratis til ${DEADLINE_LABEL} — ingen kortinfo nødvendig`
                : `${daysFree} dager gratis — ingen kortinfo nødvendig`,
              'Tilgang til alle Premium-funksjoner',
              'For deg som er tidlig ute og vil forme produktet.',
            ].map(perk => (
              <li key={perk} style={s.checkItem}>
                <span style={s.checkMark}>✓</span>
                <span>{perk}</span>
              </li>
            ))}
          </ul>

          {isPremium ? (
            <>
              <div style={s.alreadyPremium}>
                Du har allerede Premium — takk!
              </div>
              <a
                href="/"
                style={s.btnSecondary}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.35)'; e.currentTarget.style.color = '#c9a84c' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d38'; e.currentTarget.style.color = '#e8e4dd' }}
              >
                ← Tilbake til forsiden
              </a>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                <button
                  style={loading ? s.btnDisabled : s.btn}
                  onClick={handleActivate}
                  disabled={loading}
                  onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88' }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                >
                  {btnLabel}
                </button>
              </div>
              {errorMsg && (
                <p style={{ fontSize: 13, color: '#f87171', textAlign: 'center', marginBottom: 12 }}>
                  {errorMsg}
                </p>
              )}
            </>
          )}

          <p style={{ fontSize: 12, color: '#e8e4dd', fontStyle: 'italic', textAlign: 'center', lineHeight: 1.6 }}>
            Ingen binding. Ingen automatisk trekk — du velger selv om du vil fortsette {showDeadline ? `etter ${DEADLINE_LABEL}` : `etter ${daysFree} dager`}.
          </p>
        </div>
      </div>

      <AuthModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        next="/founders"
        description="Logg inn for å aktivere din gratis Founders-måned — ingen kortinfo nødvendig."
      />
    </div>
  )
}
