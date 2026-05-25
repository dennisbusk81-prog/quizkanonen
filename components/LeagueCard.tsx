'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export type LeagueEntry = { displayName: string; value: number }
export type LeagueCardData = {
  id: string
  name: string
  top3: LeagueEntry[]
  fromFallback: boolean
}

function truncateName(name: string, max = 20): string {
  if (name.length <= max) return name
  return name.slice(0, max) + '…'
}

const PREF_KEY = 'qk_preferred_league'

export default function LeagueCard({ leagues }: { leagues: LeagueCardData[] }) {
  const [selectedId, setSelectedId] = useState<string>(leagues[0]?.id ?? '')

  // Restore saved preference from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREF_KEY)
      if (saved && leagues.some(l => l.id === saved)) {
        setSelectedId(saved)
      }
    } catch {
      // localStorage unavailable (e.g. private browsing with strict settings)
    }
  }, [leagues])

  const selected = leagues.find(l => l.id === selectedId) ?? leagues[0]
  if (!selected) return null

  const handleChange = (id: string) => {
    setSelectedId(id)
    try { localStorage.setItem(PREF_KEY, id) } catch { /* ignore */ }
  }

  return (
    <div className="qkp-plain-card">
      <p className="qkp-section-label">Din liga</p>

      {/* Velger — kun synlig når brukeren er i flere ligaer */}
      {leagues.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{
            fontSize: 11,
            color: '#7a7873',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 6,
          }}>
            Velg liga
          </p>
          <select
            value={selectedId}
            onChange={e => handleChange(e.target.value)}
            onMouseEnter={e => { (e.currentTarget as HTMLSelectElement).style.borderColor = '#c9a84c' }}
            onMouseLeave={e => { (e.currentTarget as HTMLSelectElement).style.borderColor = '#2a2d38' }}
            style={{
              width: '100%',
              background: '#21242e',
              border: '1px solid #2a2d38',
              borderRadius: '8px',
              padding: '8px 12px',
              fontFamily: "'Instrument Sans', sans-serif",
              fontSize: '13px',
              color: '#e8e4dd',
              outline: 'none',
              cursor: 'pointer',
              appearance: 'auto',
              transition: 'border-color 0.2s',
            }}
          >
            {leagues.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      <p style={{
        fontFamily: "'Libre Baskerville', serif",
        fontSize: 18,
        fontWeight: 700,
        color: '#ffffff',
        marginBottom: 16,
      }}>
        {selected.name}
      </p>

      {selected.top3.length > 0 ? (
        <>
          <div className="qk-top3-rows qkp-league-top3">
            {selected.top3.map((m, i) => (
              <div key={i} className="qk-top3-row">
                <div className="qk-top3-left">
                  <span style={{ fontSize: 13, color: '#7a7873', width: 18, flexShrink: 0, fontWeight: 600 }}>
                    {i + 1}.
                  </span>
                  <span className="qk-top3-name">{truncateName(m.displayName)}</span>
                </div>
                <div className="qk-top3-right">
                  {m.value} {selected.fromFallback ? 'riktige' : 'poeng'}
                </div>
              </div>
            ))}
          </div>
          {selected.fromFallback && (
            <p style={{ fontSize: 11, color: '#7a7873', marginTop: 8, marginBottom: 0 }}>
              Sesongpoeng beregnes når quizen stenger
            </p>
          )}
        </>
      ) : (
        <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 16 }}>
          Ingen har spilt ennå
        </p>
      )}

      <Link href="/liga" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
        Se alle ligaer →
      </Link>
    </div>
  )
}
