// ── Next.js instrumentation hook ─────────────────────────────────────────────
// Kjøres én gang per serverprosess, før noe annet. Vi laster Sentry-initen som
// hører til runtime-en vi faktisk står i — edge-bundelen tåler ikke Node-APIene
// server-initen drar inn, så et betingelsesløst import ville brutt middlewaren.

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Fanger feil som kastes under gjengivelse av Server Components og i route
// handlers. Uten denne ville nettopp de feilene blitt til en anonym 500 i
// Vercel-loggen og aldri nådd Sentry.
export const onRequestError = Sentry.captureRequestError
