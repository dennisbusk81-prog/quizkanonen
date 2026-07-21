'use client'
import { useState } from 'react'

export default function NotifyForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    const trimmed = email.trim()
    if (!trimmed) return
    setLoading(true)
    try {
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      setSent(true)
    } catch { /* stille — vis bekreftelse uansett */ } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <p style={{
        fontSize: 14,
        color: '#4ade80',
        fontFamily: "'Instrument Sans', sans-serif",
        textAlign: 'center',
        lineHeight: 1.6,
      }}>
        Du får beskjed når neste quiz er klar!
      </p>
    )
  }

  return (
    <div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !loading && handleSubmit()}
        placeholder="din@epost.no"
        style={{
          background: '#1a1c23',
          border: '1px solid #2a2d38',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 14,
          color: '#ffffff',
          fontFamily: "'Instrument Sans', sans-serif",
          outline: 'none',
          flex: '1 1 180px',
          minWidth: 0,
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.5)' }}
        onBlur={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
      />
      <button
        onClick={handleSubmit}
        disabled={loading || !email.trim()}
        style={{
          background: 'transparent',
          color: '#e8e4dd',
          fontFamily: "'Instrument Sans', sans-serif",
          fontSize: 14,
          fontWeight: 600,
          padding: '10px 20px',
          borderRadius: 10,
          border: '1px solid #2a2d38',
          cursor: loading || !email.trim() ? 'not-allowed' : 'pointer',
          opacity: loading || !email.trim() ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { if (!loading && email.trim()) e.currentTarget.style.borderColor = 'rgba(201,168,76,0.5)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
      >
        {loading ? 'Sender…' : 'Varsle meg'}
      </button>
    </div>
    <p style={{ fontSize: 12, color: '#7a7873', marginTop: 8, textAlign: 'center' }}>
      Ett varsel når quizen åpner. Ingen reklame. Meld deg av når som helst.
    </p>
    </div>
  )
}
