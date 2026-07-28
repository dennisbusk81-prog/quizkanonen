'use client'

import { useEffect } from 'react'

/**
 * Utfordre-bekreftelse — delt av ALLE tre inngangene til H2H Duell:
 * leaderboard-radene (app/leaderboard/[id]/page.tsx), duell-forslagene på
 * quiz-resultatskjermen (app/quiz/[id]/page.tsx) og toppliste-radene
 * (components/SeasonLeaderboard.tsx). Kalleren eier `pending`-state og selve
 * utfordre-kallet (POST /api/rivalries), siden sidene oppdaterer ulik lokal
 * state etterpå.
 *
 * Escape-lukking og scroll-lås ligger HER, ikke hos kalleren (28. juli 2026).
 * De lå tidligere i en useEffect i leaderboard/[id] alene, så quiz-siden manglet
 * begge og SeasonLeaderboard hadde i tillegg sin egen inline-modal helt uten
 * dialog-semantikk (FUNN 1.1). Med oppførselen i komponenten kan ingen ny
 * kaller gå glipp av den.
 */
type Props = {
  pending: { id: string; name: string } | null
  onCancel: () => void
  onConfirm: (id: string) => void
}

export default function DuelChallengeModal({ pending, onCancel, onConfirm }: Props) {
  const isOpen = pending !== null

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handleKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, onCancel])

  if (!pending) return null
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qk-challenge-title"
        onClick={e => e.stopPropagation()}
        style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px 24px', maxWidth: 360, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}
      >
        <p id="qk-challenge-title" style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>
          Utfordre {pending.name}?
        </p>
        <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 24 }}>
          Du sender en H2H-duell-utfordring. Motstanderen kan godta eller avslå.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => onConfirm(pending.id)}
            style={{ flex: 1, background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' }}
          >
            Send utfordring
          </button>
          <button
            onClick={onCancel}
            style={{ flex: 1, background: 'transparent', color: '#e8e4dd', border: '1px solid #2a2d38', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 600, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' }}
          >
            Avbryt
          </button>
        </div>
      </div>
    </div>
  )
}
