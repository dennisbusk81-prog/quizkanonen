'use client'
import { useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'

// Passordfelt med vis/skjul-ikon (øye). Delt mellom /login, /sett-passord og
// /profil, som ellers styles ulikt: de to første bruker CSS-klasser, profilsiden
// bruker inline style-objekter. Derfor tar komponenten imot BEGGE deler og lar
// kalleren bestemme utseendet — den legger kun til ikonet og plassen det trenger.
//
// Layout: wrapperen er position:relative og bærer bunnmargen, mens selve inputen
// får marginBottom 0. Da kan ikonet sentreres på inputens faktiske høyde
// (top: 50%) uten at en margin på inputen forskyver det nedover.

const ICON_SLOT = 44 // plass til ikonet, så teksten aldri havner under det

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  className?: string
  style?: CSSProperties
  wrapperStyle?: CSSProperties
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
  disabled?: boolean
  autoFocus?: boolean
  /** Bunnmarg på wrapperen. Send 0 når kalleren styrer avstanden selv. */
  marginBottom?: number
}

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  className,
  style,
  wrapperStyle,
  onKeyDown,
  onFocus,
  onBlur,
  disabled,
  autoFocus,
  marginBottom = 16,
}: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <div style={{ position: 'relative', marginBottom, ...wrapperStyle }}>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        style={{ ...style, marginBottom: 0, paddingRight: ICON_SLOT, width: '100%' }}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Skjul passord' : 'Vis passord'}
        aria-pressed={visible}
        title={visible ? 'Skjul passord' : 'Vis passord'}
        style={{
          position: 'absolute',
          top: '50%',
          right: 12,
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          padding: 0,
          background: 'none',
          border: 'none',
          color: '#e8e4dd',
          cursor: 'pointer',
          lineHeight: 0,
        }}
      >
        {visible ? eyeOffSvg : eyeSvg}
      </button>
    </div>
  )
}

const eyeSvg = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
)

const eyeOffSvg = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.9 5.8A9.9 9.9 0 0 1 12 5.5c7 0 10.5 6.5 10.5 6.5a17.6 17.6 0 0 1-3.4 4.2" />
    <path d="M6.2 6.7A17.4 17.4 0 0 0 1.5 12S5 18.5 12 18.5c2 0 3.7-.5 5.1-1.3" />
    <path d="M9.8 9.9a3.2 3.2 0 0 0 4.4 4.4" />
    <path d="M3 3l18 18" />
  </svg>
)
