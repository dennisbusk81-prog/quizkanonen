'use client'

/**
 * Utfordre-bekreftelse — delt av leaderboard-radene (app/leaderboard/[id]/page.tsx)
 * og duell-forslagene på quiz-resultatskjermen (app/quiz/[id]/page.tsx), slik at
 * begge inngangene til H2H Duell bruker nøyaktig samme bekreftelsesflyt i stedet
 * for to divergerende modaler. Rent presentasjonskomponent — kalleren eier
 * `pending`-state og selve utfordre-kallet (POST /api/rivalries), siden de to
 * sidene oppdaterer ulik lokal state etterpå.
 */
type Props = {
  pending: { id: string; name: string } | null
  onCancel: () => void
  onConfirm: (id: string) => void
}

export default function DuelChallengeModal({ pending, onCancel, onConfirm }: Props) {
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
