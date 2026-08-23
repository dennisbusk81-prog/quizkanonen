'use client'
import { useEffect, useState } from 'react'

// Målet for «Åpne i Chrome» er SIDEN BRUKEREN STÅR PÅ, ikke /login.
//
// Fram til 24. august 2026 var intent-lenken hardkodet til
// `quizkanonen.no/login`. Så lenge advarselen bare ble vist på /login var det
// riktig; i det øyeblikket quiz-siden fikk sitt eget innloggingspanel (samme
// dato) ble den feil på den flaten som betyr mest: en besøkende fra
// Facebook-gruppa som står på /quiz/<id>, trykker «Åpne i Chrome» og havner på
// innloggingssiden — uten quizen, og uten `?next=` til å finne tilbake.
// Publikum kommer fra Facebook, så dette er hovedveien inn, ikke en utkant.
//
// Vi bygger derfor målet av gjeldende host + path + query. På /login er
// resultatet uendret i praksis (`/login?next=…` tas med, som er en
// forbedring); på quiz-siden peker den på quizen.
function currentTarget(): string {
  const { host, pathname, search } = window.location
  return `${host}${pathname}${search}`
}

function detectInApp(): { inApp: boolean; isAndroid: boolean; target: string } {
  const ua = navigator.userAgent
  const inApp = /FBAN|FBAV|Instagram|Snapchat|LinkedInApp/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  return { inApp, isAndroid, target: currentTarget() }
}

export default function InAppBrowserWarning() {
  const [state, setState] = useState<{ inApp: boolean; isAndroid: boolean; target: string } | null>(null)
  // detectInApp leser navigator.userAgent, som ikke finnes under SSR.
  // Deteksjonen må skje etter montering; en useState-initializer ville krasjet
  // på serveren.
  // eslint-disable-next-line react-hooks/set-state-in-effect
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
          href={`intent://${state.target}#Intent;scheme=https;package=com.android.chrome;end`}
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
          color: '#918f8a',
          marginTop: 10,
          lineHeight: 1.5,
        }}>
          Trykk på ⋯ øverst i høyre hjørne og velg &quot;Åpne i Safari&quot;.
        </p>
      )}
    </div>
  )
}
