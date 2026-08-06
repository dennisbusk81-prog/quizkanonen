'use client'
import { useEffect, useState } from 'react'
import { WELCOME_BANNER_SEEN_KEY } from '@/lib/welcome-onboarding'

// Nøkkelen deles med /velkommen, som stempler den før den navigerer videre:
// en fersk bruker som nettopp har lest velkomstsiden skal ikke møte et banner
// som sier omtrent det samme. Uendret oppførsel for alle andre.
const STORAGE_KEY = WELCOME_BANNER_SEEN_KEY

export default function WelcomeBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Show only on the very first visit — mark immediately so it won't repeat
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, '1')
      // localStorage finnes ikke under SSR, så dette KAN ikke leses i en
      // useState-initializer uten hydration mismatch. Lesing av nettleser-verdi
      // etter montering er det tiltenkte mønsteret; alternativet
      // (useSyncExternalStore) ville vært en omskriving, ikke en lint-fiks.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
          Ukentlig quiz for folk som tar kunnskap på alvor — gratis å spille, logg inn med Google og konkurrer mot de samme menneskene hver uke.
        </p>
        <button
          onClick={() => setVisible(false)}
          aria-label="Lukk banner"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#918f8a',
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
