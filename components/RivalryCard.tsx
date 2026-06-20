'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

type RivalryRow = {
  id: string
  status: 'active' | 'pending' | 'declined'
  isChallenger: boolean
  isExpired: boolean
  opponentId: string
  opponentName: string | null
  opponentAvatar: string | null
  myPoints: number
  opponentPoints: number
  isUnseen?: boolean
}

type Props = {
  isPremium: boolean
  prioritySlot?: 'top' | 'default'
}

export default function RivalryCard({ isPremium, prioritySlot }: Props) {
  const [rivalries, setRivalries] = useState<RivalryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [justAcceptedId, setJustAcceptedId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }
    try {
      const res = await fetch('/api/rivalries/my', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const json = await res.json()
        const rows: RivalryRow[] = json.rivalries ?? []
        setRivalries(rows)
        // Mark unseen incoming challenges as seen
        const unseen = rows.find(r => r.isUnseen && !r.isChallenger && r.status === 'pending')
        if (unseen) {
          fetch(`/api/rivalries/${unseen.id}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'seen' }),
          }).catch(() => {/* non-critical */})
        }
      }
    } catch { /* non-critical */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(id: string, action: 'accept' | 'decline' | 'cancel') {
    setActionLoading(id + action)
    setActionError(null)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setActionLoading(null); return }
    try {
      let res: Response
      if (action === 'cancel') {
        res = await fetch(`/api/rivalries/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      } else {
        res = await fetch(`/api/rivalries/${id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action }),
        })
      }
      // Fix 2: surface errors from failed actions
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        const msg = json.error ?? 'Noe gikk galt. Prøv igjen.'
        setActionError(msg)
        setTimeout(() => setActionError(null), 3000)
        setActionLoading(null)
        return
      }
    } catch {
      setActionError('Noe gikk galt. Prøv igjen.')
      setTimeout(() => setActionError(null), 3000)
      setActionLoading(null)
      return
    }
    setActionLoading(null)
    if (action === 'accept') {
      setJustAcceptedId(id)
      setRivalries(prev => prev.map(r => r.id === id ? { ...r, status: 'active' as const, isChallenger: true } : r))
    } else if (action === 'decline') {
      setRivalries(prev => prev.filter(r => r.id !== id))
    } else {
      load()
    }
  }

  if (!isPremium) return null
  if (loading) return null

  // Aktive/ventende dueller (denne måneden)
  const activeDuel = rivalries.find(r => r.status === 'active'  && !r.isExpired) ?? null
  const outgoing   = rivalries.find(r => r.status === 'pending' && r.isChallenger  && !r.isExpired) ?? null
  const incoming   = rivalries.find(r => r.status === 'pending' && !r.isChallenger && !r.isExpired) ?? null
  // Historiske dueller: utløpte fra forrige måned + avslåtte
  const historicalDuels = rivalries.filter(r => r.isExpired || r.status === 'declined')

  // Slot-logikk: 'top' vises kun ved innkommende utfordring; 'default' skjules da
  if (prioritySlot === 'top' && !incoming) return null
  if (prioritySlot === 'default' && incoming) return null

  const opponentName = (r: RivalryRow) => r.opponentName ?? 'Ukjent'

  // Shared inline error element (Fix 2)
  const errorEl = actionError ? (
    <p style={{ fontSize: 13, color: '#E24B4A', marginTop: 10 }}>
      {actionError}
    </p>
  ) : null

  // Kollapset historikk-seksjon (kun i default-slot)
  const historySectionEl = prioritySlot !== 'top' && historicalDuels.length > 0 ? (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setHistoryOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#7a7873', letterSpacing: '0.04em' }}>
          Tidligere dueller
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }}>
          <path d="M1 1L5 5L9 1" stroke="#7a7873" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      {historyOpen && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {historicalDuels.map(r => {
            const statusLabel = r.isExpired ? 'Avsluttet' : r.status === 'declined' ? (r.isChallenger ? 'Avslått' : 'Avslåtte') : r.status
            return (
              <div key={r.id} style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 13, color: '#e8e4dd', fontWeight: 600, marginBottom: 2 }}>
                    {opponentName(r)}
                  </p>
                  <p style={{ fontSize: 11, color: '#7a7873' }}>{statusLabel}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: '#7a7873' }}>
                    {r.myPoints} – {r.opponentPoints}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  ) : null

  // ── Active duel ──────────────────────────────────────────────
  if (activeDuel) {
    const me = activeDuel.myPoints
    const them = activeDuel.opponentPoints
    const outcome = me > them ? 'winning' : me < them ? 'losing' : 'tied'
    const borderColor =
      outcome === 'winning' ? 'rgba(76,175,125,0.3)' :
      outcome === 'losing'  ? 'rgba(201,76,76,0.3)'  :
                              'rgba(201,168,76,0.25)'
    const outcomeColor =
      outcome === 'winning' ? '#4caf7d' :
      outcome === 'losing'  ? '#c94c4c' : '#c9a84c'
    const outcomeLabel =
      outcome === 'winning' ? 'Du leder' :
      outcome === 'losing'  ? 'Du ligger under' : 'Likt'

    return (
      <Fragment>
        <div style={{
          background: '#21242e',
          border: `1px solid ${borderColor}`,
          borderRadius: 16,
          padding: '18px 20px',
          marginTop: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7a7873', margin: 0 }}>
              Duell — denne måneden
            </p>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: outcomeColor }}>
              {outcomeLabel}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#c9a84c', lineHeight: 1, margin: '0 0 4px' }}>
                {me}
              </p>
              <p style={{ fontSize: 11, color: '#7a7873', margin: 0 }}>Deg</p>
            </div>

            <p style={{ fontSize: 13, fontWeight: 700, color: '#2a2d38', flexShrink: 0, margin: 0 }}>vs</p>

            <div style={{ flex: 1, textAlign: 'center' }}>
              <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#e8e4dd', lineHeight: 1, margin: '0 0 4px' }}>
                {them}
              </p>
              <p style={{ fontSize: 11, color: '#7a7873', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {opponentName(activeDuel)}
              </p>
            </div>
          </div>

          {justAcceptedId === activeDuel.id && (
            <p style={{ fontSize: 13, color: '#e8e4dd', margin: '10px 0 0', lineHeight: 1.5 }}>
              Duell akseptert! Følg med på resultatet etter fredagens quiz.
            </p>
          )}
          <p style={{ fontSize: 11, color: '#e8e4dd', textAlign: 'center', margin: '10px 0 0', lineHeight: 1.4 }}>
            Poeng fra ukens quiz. Duellen nullstilles neste måned.
          </p>

          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <button
              onClick={() => handleAction(activeDuel.id, 'cancel')}
              disabled={actionLoading !== null}
              style={{
                background: 'none',
                border: 'none',
                color: '#e8e4dd',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: "'Instrument Sans', sans-serif",
                padding: 0,
                textDecoration: 'underline',
              }}
            >
              {actionLoading === activeDuel.id + 'cancel' ? 'Kansellerer...' : 'Avslutt duell'}
            </button>
          </div>
          {errorEl}
        </div>
        {historySectionEl}
      </Fragment>
    )
  }

  // ── Incoming pending challenge ────────────────────────────────
  if (incoming) {
    const isUnseen = incoming.isUnseen ?? false
    return (
      <div style={{
        background: 'rgba(201,168,76,0.06)',
        border: '1px solid rgba(201,168,76,0.3)',
        borderRadius: 16,
        padding: '18px 20px',
        marginTop: 12,
      }}>
        {isUnseen && (
          <p style={{
            fontSize: 12,
            fontWeight: 700,
            color: '#c9a84c',
            marginBottom: 10,
            letterSpacing: '0.02em',
          }}>
            Du har en ny duell-utfordring!
          </p>
        )}
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 8 }}>
          Duell-utfordring
        </p>
        <p style={{ fontSize: 15, color: '#e8e4dd', marginBottom: 14, lineHeight: 1.5 }}>
          <strong style={{ color: '#c9a84c' }}>{opponentName(incoming)}</strong> har utfordret deg til duell denne måneden!
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => handleAction(incoming.id, 'accept')}
            disabled={actionLoading !== null}
            style={{
              flex: 1,
              padding: '10px 0',
              background: '#c9a84c',
              color: '#1a1c23',
              border: 'none',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: "'Instrument Sans', sans-serif",
            }}
          >
            {actionLoading === incoming.id + 'accept' ? 'Aksepterer...' : 'Aksepter'}
          </button>
          <button
            onClick={() => handleAction(incoming.id, 'decline')}
            disabled={actionLoading !== null}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'none',
              color: '#e8e4dd',
              border: '1px solid #2a2d38',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'Instrument Sans', sans-serif",
            }}
          >
            {actionLoading === incoming.id + 'decline' ? 'Avslår...' : 'Avslå'}
          </button>
        </div>
        {errorEl}
      </div>
    )
  }

  // ── Outgoing pending ─────────────────────────────────────────
  if (outgoing) {
    return (
      <Fragment>
        <div style={{
          background: '#21242e',
          border: '1px solid #2a2d38',
          borderRadius: 16,
          padding: '18px 20px',
          marginTop: 12,
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 8 }}>
            Duell — venter på svar
          </p>
          <p style={{ fontSize: 15, color: '#e8e4dd', lineHeight: 1.5, marginBottom: 12 }}>
            Du har utfordret{' '}
            <strong style={{ color: '#c9a84c' }}>{opponentName(outgoing)}</strong>{' '}
            til duell. Venter på svar…
          </p>
          <button
            onClick={() => handleAction(outgoing.id, 'cancel')}
            disabled={actionLoading !== null}
            style={{
              background: 'none',
              border: 'none',
              color: '#e8e4dd',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: "'Instrument Sans', sans-serif",
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            {actionLoading === outgoing.id + 'cancel' ? 'Trekker tilbake...' : 'Trekk tilbake utfordringen'}
          </button>
          {errorEl}
        </div>
        {historySectionEl}
      </Fragment>
    )
  }

  // ── No active rivalry — invite to challenge + history ─────────
  return (
    <Fragment>
      <div style={{
        background: '#21242e',
        border: '1px solid #2a2d38',
        borderRadius: 16,
        padding: '18px 20px',
        marginTop: 12,
      }}>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 8 }}>
          Duell
        </p>
        <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.5, marginBottom: 10 }}>
          Utfordre en spiller og mål dere mot hverandre gjennom måneden.
        </p>
        <Link href="/toppliste" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
          Utfordre en rival →
        </Link>
      </div>
      {historySectionEl}
    </Fragment>
  )
}
