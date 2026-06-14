'use client'
import { useEffect, useState } from 'react'

function isInAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|Snapchat|TikTok|Twitter|LinkedIn|WhatsApp/i.test(navigator.userAgent)
}

export default function InAppBrowserWarning() {
  const [show, setShow] = useState(false)
  useEffect(() => { setShow(isInAppBrowser()) }, [])
  if (!show) return null

  return (
    <div style={{
      background: '#2a1a0a',
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
        Åpne i Safari eller Chrome
      </p>
      <p style={{
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 13,
        color: '#e8e4dd',
        lineHeight: 1.6,
        margin: 0,
      }}>
        Det ser ut til at du bruker en nettleser inne i en app. Google-innlogging fungerer ikke her. Åpne quizkanonen.no i Safari eller Chrome for å logge inn.
      </p>
    </div>
  )
}
