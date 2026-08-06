import type { CSSProperties } from 'react'

// Presentasjonslaget som er FELLES for de to velkomstflatene:
// /org/[slug]/velkommen (bedriftsadmin) og /velkommen (ny B2C-bruker).
//
// HVA SOM DELES, OG HVA SOM IKKE GJØR DET:
// Kun stiler. De to sidene har bevisst MOTSATT tilstandsmodell — org-siden
// forhåndsvelger ingenting og tåler gjensyn (et gjensyn med forhåndsvalg kunne
// stille skrudd på global synlighet for alle ansatte), mens B2C-siden
// forhåndsvelger alt og vises nøyaktig én gang. En delt logikk-komponent hadde
// blitt et props-skall der hver eneste atferd var en flagg-parameter, altså to
// implementasjoner i én fil.
//
// Men «kortet er #21242e med 16px radius» er identiske krav på begge, og lå til
// 6. august 2026 hardkodet lokalt i org-siden. Verdiene under er FLYTTET
// derfra, uendret, tegn for tegn.

export const WELCOME_FONT_IMPORT =
  `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

export const welcomeCard: CSSProperties = {
  background: '#21242e',
  border: '1px solid #2a2d38',
  borderRadius: 16,
  padding: '28px 24px',
  marginBottom: 16,
}

export const welcomeStepLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#918f8a',
  marginBottom: 10,
}

export const welcomeHeading: CSSProperties = {
  fontFamily: "'Libre Baskerville', serif",
  fontSize: 19,
  fontWeight: 700,
  color: '#ffffff',
  lineHeight: 1.3,
  marginBottom: 8,
}

export const welcomeBodyText: CSSProperties = {
  fontSize: 14,
  color: '#e8e4dd',
  lineHeight: 1.65,
}

// #918f8a, ikke #7a7873: hint-tonen ble hevet 1. august 2026 fordi den gamle ga
// 3,51:1 mot kort-bakgrunnen #21242e — som er nettopp flaten denne teksten
// ligger på her.
export const welcomeHintText: CSSProperties = {
  fontSize: 13,
  color: '#918f8a',
  lineHeight: 1.6,
}

export const welcomeScreen: CSSProperties = {
  minHeight: '100vh',
  background: '#1a1c23',
  fontFamily: "'Instrument Sans', sans-serif",
  color: '#e8e4dd',
}

export const welcomeColumn: CSSProperties = {
  maxWidth: 620,
  margin: '0 auto',
  padding: '52px 20px 80px',
}

export const welcomeEyebrow: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#c9a84c',
  marginBottom: 10,
}

export const welcomeTitle: CSSProperties = {
  fontFamily: "'Libre Baskerville', serif",
  fontSize: 'clamp(26px, 5vw, 34px)',
  fontWeight: 700,
  color: '#ffffff',
  letterSpacing: '-0.02em',
  lineHeight: 1.15,
  marginBottom: 10,
}

export const welcomeErrorBox: CSSProperties = {
  fontSize: 13,
  color: '#f87171',
  background: 'rgba(248,113,113,0.08)',
  border: '1px solid rgba(248,113,113,0.18)',
  borderRadius: 10,
  padding: '10px 14px',
  marginBottom: 14,
  lineHeight: 1.5,
}

/** Gul fullbredde-primærknapp. `disabled` styrer kun cursor og opacity. */
export function welcomePrimaryButton(disabled: boolean): CSSProperties {
  return {
    width: '100%',
    background: '#c9a84c',
    color: '#1a1c23',
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: 15,
    fontWeight: 700,
    padding: '13px',
    borderRadius: 10,
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  }
}
