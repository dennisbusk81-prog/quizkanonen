'use client'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'qk_welcomed'

export default function WelcomeBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Show only on the very first visit — mark immediately so it won't repeat
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, '1')
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  return (
    <div style={{
      width: '100%',
      background: 'rgba(201, 168, 76, 0.07)',
      borderBottom: '1px solid rgba(201, 168, 76, 0.15)',
      padding: '10px 20px',
    }}>
      <div style={{
        maxWidth: 720,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <p style={{
          fontSize: 13,
          color: '#e8e4dd',
          lineHeight: 1.5,
          margin: 0,
          flex: 1,
          textAlign: 'center',
        }}>
          Ukentlig quiz for folk som tar kunnskap på alvor — spill gratis, konkurrer mot de samme menneskene hver uke.
        </p>
        <button
          onClick={() => setVisible(false)}
          aria-label="Lukk banner"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#7a7873',
            fontSize: 18,
            lineHeight: 1,
            padding: '2px 4px',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
