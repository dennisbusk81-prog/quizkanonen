'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const NAME_RE = /^[\p{L}\s\-']{2,40}$/u

export default function NameRequiredModal() {
  const [open, setOpen] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('qk:name-required', handler)
    return () => window.removeEventListener('qk:name-required', handler)
  }, [])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const trimmed = nameInput.trim()
  const isValid = NAME_RE.test(trimmed)

  async function handleSave() {
    if (!isValid || saving) return
    setSaving(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { setError('Ikke innlogget. Prøv å laste siden på nytt.'); setSaving(false); return }

      const res = await fetch('/api/profile/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: session.user.id, display_name: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Noe gikk galt. Prøv igjen.')
        setSaving(false)
        return
      }
      setOpen(false)
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,11,15,0.80)',
        backdropFilter: 'blur(4px)',
        zIndex: 9100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: "'Instrument Sans', sans-serif",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Velg visningsnavn"
    >
      <div style={{
        width: '100%',
        maxWidth: '360px',
        background: '#21242e',
        border: '1px solid #2a2d38',
        borderRadius: '20px',
        padding: '36px 28px 32px',
      }}>
        <p style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#c9a84c',
          marginBottom: 12,
        }}>
          Velg ditt navn
        </p>
        <h2 style={{
          fontFamily: "'Libre Baskerville', serif",
          fontSize: 22,
          fontWeight: 700,
          color: '#ffffff',
          marginBottom: 10,
          lineHeight: 1.25,
        }}>
          Hva skal vi kalle deg?
        </h2>
        <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 24, lineHeight: 1.6 }}>
          Dette navnet vises på leaderboard og topplister. Bruk ditt vanlige navn så andre kjenner deg igjen.
        </p>

        <input
          ref={inputRef}
          type="text"
          value={nameInput}
          onChange={e => { setNameInput(e.target.value); setError(null) }}
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          placeholder="Fornavn Etternavn"
          maxLength={40}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#1a1c23',
            border: '1px solid #2a2d38',
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: 15,
            color: '#ffffff',
            fontFamily: "'Instrument Sans', sans-serif",
            outline: 'none',
            marginBottom: 8,
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#c9a84c' }}
          onBlur={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
        />

        {error && (
          <p style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{error}</p>
        )}

        <button
          onClick={handleSave}
          disabled={!isValid || saving}
          style={{
            width: '100%',
            padding: '12px',
            background: isValid && !saving ? '#c9a84c' : '#3a3d4a',
            color: isValid && !saving ? '#0f0f10' : '#7a7873',
            border: 'none',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            fontFamily: "'Instrument Sans', sans-serif",
            cursor: isValid && !saving ? 'pointer' : 'not-allowed',
            marginTop: 4,
          }}
        >
          {saving ? 'Lagrer…' : 'Bekreft navn'}
        </button>

        <p style={{ fontSize: 11, color: '#7a7873', marginTop: 14, textAlign: 'center', lineHeight: 1.5 }}>
          Kun bokstaver, mellomrom og bindestrek. Du kan endre navnet senere på profilsiden.
        </p>
      </div>
    </div>
  )
}
