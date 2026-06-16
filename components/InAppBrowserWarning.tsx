'use client'
import { useEffect, useState } from 'react'

function detectInApp(): { inApp: boolean; isAndroid: boolean } {
  const ua = navigator.userAgent
  const inApp = /FBAN|FBAV|Instagram|Snapchat|LinkedInApp/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  return { inApp, isAndroid }
}

export default function InAppBrowserWarning() {
  const [state, setState] = useState<{ inApp: boolean; isAndroid: boolean } | null>(null)
  useEffect(() => { setState(detectInApp()) }, [])
  if (!state?.inApp) return null

  return (
    <div style={{
      background: '#21242e',
      border: '1px solid #c9a84c',
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 16,
    }}>
      <p style={{
        fontFamily: "'Libre Baskerville', serif",
        fontSize: 14,
        fontWeight: 700,
        color: '#ffffff',
        marginBottom: 6,
      }}>
        Google-innlogging virker ikke her
      </p>
      <p style={{
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 13,
        color: '#e8e4dd',
        lineHeight: 1.6,
        margin: 0,
      }}>
        Du bruker en innebygd nettleser. Åpne siden i Chrome eller Safari for å logge inn med Google.
      </p>
      {state.isAndroid ? (
        <a
          href="intent://quizkanonen.no/login#Intent;scheme=https;package=com.android.chrome;end"
          style={{
            display: 'inline-block',
            marginTop: 12,
            padding: '8px 20px',
            background: 'transparent',
            border: '1px solid #e8e4dd',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            color: '#e8e4dd',
            textDecoration: 'none',
            fontFamily: "'Instrument Sans', sans-serif",
          }}
        >
          Åpne i Chrome
        </a>
      ) : (
        <p style={{
          fontFamily: "'Instrument Sans', sans-serif",
          fontSize: 12,
          color: '#7a7873',
          marginTop: 10,
          lineHeight: 1.5,
        }}>
          Trykk på ⋯ øverst i høyre hjørne og velg &quot;Åpne i Safari&quot;.
        </p>
      )}
    </div>
  )
}
