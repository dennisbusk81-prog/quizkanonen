'use client'

import { useState } from 'react'
import { formatRemovalDate, MAX_MONTHS_AHEAD } from '@/lib/scheduled-removal'

// Bekreftelsesmodal for PLANLAGT fjerning av et org-medlem.
//
// Samme modal-skall som «Avslutt bedriftskonto» i bedriftspanelet, og samme
// sikring: navnet må skrives inn. En planlagt fjerning utløser på en dato ingen
// sitter og ser på, så den skal koste like mye å bekrefte som en sletting.
//
// Konsekvensteksten oppdateres live med valgt dato, slik at admin leser den
// EKSAKTE datoen og hva som faktisk skjer før de bekrefter.

type Props = {
  membershipId: string
  memberName: string
  orgName: string
  accessToken: string
  /** Satt ved «Endre dato» — forhåndsutfyller feltet. */
  currentDate?: string | null
  onClose: () => void
  onSaved: () => void
}

/** YYYY-MM-DD i UTC — samme grunnlag som lib/scheduled-removal.ts bruker. */
function isoDay(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10)
}

export default function ScheduleRemovalModal({
  membershipId,
  memberName,
  orgName,
  accessToken,
  currentDate,
  onClose,
  onSaved,
}: Props) {
  const now = new Date()
  const minDate = isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)))
  const maxDate = isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + MAX_MONTHS_AHEAD, now.getUTCDate())))

  const [date, setDate] = useState(currentDate ? currentDate.slice(0, 10) : '')
  const [confirmInput, setConfirmInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameMatches = confirmInput.trim() === memberName.trim()
  const canSave = !!date && nameMatches && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/org/members/${membershipId}/schedule-removal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ scheduledFor: date }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Kunne ikke lagre datoen. Prøv igjen.')
        return
      }
      onSaved()
    } catch {
      setError('Kunne ikke lagre datoen. Prøv igjen.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px', maxWidth: 440, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>

        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>
          {currentDate ? 'Endre planlagt fjerning' : 'Planlegg fjerning'}
        </p>

        <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20 }}>
          Velg datoen <strong style={{ color: '#ffffff' }}>{memberName}</strong> skal fjernes fra {orgName}.
        </p>

        <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7873', display: 'block', marginBottom: 8 }}>
          Fjernes den
        </label>
        <input
          type="date"
          value={date}
          min={minDate}
          max={maxDate}
          onChange={e => { setDate(e.target.value); setError(null) }}
          style={{
            width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8,
            padding: '10px 12px', fontSize: 14, color: '#e8e4dd',
            fontFamily: "'Instrument Sans', sans-serif", outline: 'none',
            marginBottom: 18, boxSizing: 'border-box',
          }}
        />

        {/* Konsekvensen, med den eksakte datoen — leses før bekreftelsen. */}
        {date && (
          <div style={{ background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
            <p style={{ fontSize: 14, color: '#ffffff', lineHeight: 1.6, marginBottom: 8 }}>
              {memberName} mister tilgangen til {orgName} {formatRemovalDate(`${date}T00:00:00.000Z`)}.
            </p>
            <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6 }}>
              Premium gjennom bedriften varer i 7 dager etter det, med mindre vedkommende
              har egen dekning. Konto, quizhistorikk og poeng beholdes.
              Planen kan avbrytes eller endres helt fram til datoen.
            </p>
          </div>
        )}

        <p style={{ fontSize: 12, color: '#7a7873', marginBottom: 8 }}>
          Skriv <strong style={{ color: '#e8e4dd' }}>{memberName}</strong> for å bekrefte:
        </p>
        <input
          type="text"
          value={confirmInput}
          onChange={e => setConfirmInput(e.target.value)}
          placeholder={memberName}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          style={{
            width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8,
            padding: '10px 12px', fontSize: 14, color: '#e8e4dd',
            fontFamily: "'Instrument Sans', sans-serif", outline: 'none',
            marginBottom: 16, boxSizing: 'border-box',
          }}
        />

        {error && (
          <p style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 8, padding: '8px 16px', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
          >
            Avbryt
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            style={{
              fontSize: 13, fontWeight: 600,
              color: canSave ? '#1a1c23' : '#7a7873',
              background: canSave ? '#f87171' : '#2a2d38',
              border: 'none', borderRadius: 8, padding: '8px 20px',
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontFamily: "'Instrument Sans', sans-serif",
            }}
          >
            {saving ? 'Lagrer…' : currentDate ? 'Lagre ny dato' : 'Planlegg fjerning'}
          </button>
        </div>

      </div>
    </div>
  )
}
