'use client'

import type React from 'react'
import type { ScopeRailOption } from '@/lib/scope-rail'

// ── Scope-skinnen — ÉN komponent for fire flater ────────────────────────────
// «Blant: Alle · Elkjøp Nordic». Segmentert kontroll: ramme #2a2d38, aktivt
// segment fylt #21242e med hvit tekst, inaktive i hint-fargen #918f8a. INGEN
// gull — dette er navigasjon, ikke en primærhandling, og flatene den står på
// har allerede sitt ene gullelement (aktiv periodefane, gullknapp).
//
// Hvilke valg som vises avgjøres av lib/scope-rail.ts (scopeRailOptions), som
// også håndhever «minst to valg». Denne komponenten rendrer det den får, og
// ingenting når lista er tom. Segmentene er LENKER, ikke knapper: skinnen
// navigerer mellom flater (samme bevisste harde navigasjon som topplinjen —
// fersk server-data ved seksjonsbytte).
//
// Etiketten ER gruppens tilgjengelige navn (aria-labelledby), ikke en
// usynlig aria-label ved siden av. Ellers ville en skjermleser fått to
// konkurrerende navn på samme kontroll.
//
// BREDDEN ER EN DEL AV VALGET. Ved 375 px med tre segmenter er det lite å gå
// på, så hvert segment er klemt til 110 px med ellipse (samme klemme som
// org-navnet i topplinjen) og skinnen kan scrolle horisontalt i nødsfall.

const railStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 3,
  border: '1px solid #2a2d38',
  borderRadius: 999,
  maxWidth: '100%',
  overflowX: 'auto',
}

const segmentStyle = (aktiv: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 999,
  border: 'none',
  fontSize: 13,
  fontWeight: aktiv ? 600 : 500,
  fontFamily: "var(--font-instrument-sans), sans-serif",
  color: aktiv ? '#ffffff' : '#918f8a',
  background: aktiv ? '#21242e' : 'transparent',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  transition: 'color 0.15s',
  maxWidth: 110,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
})

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#918f8a',
  fontFamily: "var(--font-instrument-sans), sans-serif",
  whiteSpace: 'nowrap',
  flexShrink: 0,
}

const SCOPE_TAB_CSS = `
  .qk-scope-tab[aria-current="false"]:hover { color: #e8e4dd; }
`

export default function ScopeRail({ options }: { options: ScopeRailOption[] }) {
  if (options.length === 0) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, margin: '0 0 14px' }}>
      <style>{SCOPE_TAB_CSS}</style>
      <span id="qk-scope-label" style={labelStyle}>Blant:</span>
      <nav style={railStyle} aria-labelledby="qk-scope-label">
        {options.map(o => (
          <a
            key={o.key}
            href={o.href}
            className="qk-scope-tab"
            style={segmentStyle(o.active)}
            aria-current={o.active ? 'page' : 'false'}
          >
            {o.label}
          </a>
        ))}
      </nav>
    </div>
  )
}
