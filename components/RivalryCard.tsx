'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

type RivalryRow = {
  id: string
  status: 'active' | 'pending'
  isChallenger: boolean
  opponentId: string
  opponentName: string | null
  opponentAvatar: string | null
  myPoints: number
  opponentPoints: number
}

type Props = {
  isPremium: boolean
}

export default function RivalryCard({ isPremium }: Props) {
  const [rivalries, setRivalries] = useState<RivalryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }
    try {
      const res = await fetch('/api/rivalries/my', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const json = await res.json()
        setRivalries(json.rivalries ?? [])
      }
    } catch { /* non-critical */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(id: string, action: 'accept' | 'decline' | 'cancel') {
    setActionLoading(id + action)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setActionLoading(null); return }
    try {
      if (action === 'cancel') {
        await fetch(`/api/rivalries/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      } else {
        await fetch(`/api/rivalries/${id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action }),
        })
      }
    } catch { /* non-critical */ }
    setActionLoading(null)
    load()
  }

  if (!isPremium) return null
  if (loading) return null

  const activeDuel  = rivalries.find(r => r.status === 'active') ?? null
  const outgoing    = rivalries.find(r => r.status === 'pending' && r.isChallenger) ?? null
  const incoming    = rivalries.find(r => r.status === 'pending' && !r.isChallenger) ?? null

  const opponentName = (r: RivalryRow) => r.opponentName ?? 'Ukjent'

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
          {/* My score */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#c9a84c', lineHeight: 1, margin: '0 0 4px' }}>
              {me}
            </p>
            <p style={{ fontSize: 11, color: '#7a7873', margin: 0 }}>Deg</p>
          </div>

          {/* VS */}
          <p style={{ fontSize: 13, fontWeight: 700, color: '#2a2d38', flexShrink: 0, margin: 0 }}>vs</p>

          {/* Opponent score */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#e8e4dd', lineHeight: 1, margin: '0 0 4px' }}>
              {them}
            </p>
            <p style={{ fontSize: 11, color: '#7a7873', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {opponentName(activeDuel)}
            </p>
          </div>
        </div>

        <p style={{ fontSize: 11, color: '#7a7873', textAlign: 'center', margin: '10px 0 0', lineHeight: 1.4 }}>
          Poeng fra ukens quiz. Duellen nullstilles neste måned.
        </p>

        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button
            onClick={() => handleAction(activeDuel.id, 'cancel')}
            disabled={actionLoading !== null}
            style={{
              background: 'none',
              border: 'none',
              color: '#7a7873',
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
      </div>
    )
  }

  // ── Incoming pending challenge ────────────────────────────────
  if (incoming) {
    return (
      <div style={{
        background: 'rgba(201,168,76,0.06)',
        border: '1px solid rgba(201,168,76,0.3)',
        borderRadius: 16,
        padding: '18px 20px',
        marginTop: 12,
      }}>
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
      </div>
    )
  }

  // ── Outgoing pending ─────────────────────────────────────────
  if (outgoing) {
    return (
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
            color: '#7a7873',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: "'Instrument Sans', sans-serif",
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          {actionLoading === outgoing.id + 'cancel' ? 'Trekker tilbake...' : 'Trekk tilbake utfordringen'}
        </button>
      </div>
    )
  }

  // ── No rivalry — invite to challenge ─────────────────────────
  return (
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
      <p style={{ fontSize: 14, color: '#7a7873', lineHeight: 1.5, marginBottom: 10 }}>
        Utfordre en spiller og mål dere mot hverandre gjennom måneden.
      </p>
      <Link href="/toppliste" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
        Utfordre en rival →
      </Link>
    </div>
  )
}
