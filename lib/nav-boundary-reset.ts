// Beslutningen «skal NavErrorBoundary nullstille krasj-tilstanden sin nå?»,
// løftet ut av components/NavErrorBoundary.tsx slik at den kan
// oppførselstestes med node:test (testglobben er lib/**/*.test.ts, og
// prosjektet har ingen React-testrigg — samme begrunnelse som
// lib/client-error.test.ts oppgir for sin struktur-del).
//
// Bakgrunn: boundaryen bor i rot-layouten (app/layout.tsx) rundt
// <GlobalNav />, og rot-layouten remontes IKKE ved klientnavigasjon i App
// Router. Uten reset var én render-krasj i SiteNav/NavAuth derfor permanent:
// fallback er null, så hele appen ble navløs for resten av økten — stille,
// bortsett fra logClientError.
//
// LØKKE-VAKTEN er selve kontrakten her: reset skjer KUN når pathname faktisk
// har endret seg. Re-renders på samme rute (context-oppdateringer i
// ProfileProvider, wrapperens egne re-renders) nullstiller aldri — en
// komponent som krasjer konsekvent krasjer dermed maks én gang per
// navigasjon, aldri i løkke.

export function shouldResetNavBoundary(
  hasError: boolean,
  prevPathname: string | null,
  nextPathname: string | null
): boolean {
  // Ikke i krasj-tilstand → aldri reset. Uten denne vakten ville hver
  // navigasjon utløst en unødvendig setState på en frisk nav.
  if (!hasError) return false
  // Sammenligningen er symmetrisk (!==), så prev/neste kan ikke forveksles
  // til en bug. null !== null er false: ukjent pathname to ganger på rad er
  // ikke en navigasjon.
  return prevPathname !== nextPathname
}
