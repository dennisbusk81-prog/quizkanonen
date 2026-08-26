'use client'

// ── SINKET: det ENESTE stedet track() kalles i hele kodebasen ────────────────
//
// Samme mønster som escapingen i lib/email-templates.ts og scrubEvent() i
// lib/sentry-scrub.ts: vakten bor ved sinket, ikke hos kallerne. Da kan ingen
// framtidig `track(...)` et sted i koden glemme regelen — det finnes ingen
// annen inngang. Beslutningen om HVA som sendes ligger i lib/analytics-event.ts
// (ren, testet for seg); denne filen gjør bare tre ting: sjekker at vi er i en
// nettleser, spør beslutningsfunksjonen, og svelger alt som går galt.
//
// ── KRAV 1: KAN ALDRI KASTE — OG FAREN ER MÅLT, IKKE TEORETISK ─────────────
// @vercel/analytics v2.0.1 sin egen `track()` KASTER med vilje når den kalles
// utenfor en nettleser og ikke i produksjon:
//
//     if (!isBrowser()) {
//       const msg = "[Vercel Web Analytics] Please import `track` from ..."
//       if (isProduction()) { console.warn(msg) } else { throw new Error(msg) }
//       return
//     }
//     — node_modules/@vercel/analytics/dist/index.mjs:194-201
//
// Spillestien er den varmeste flaten i produktet. En feilende måling skal aldri
// kunne bryte en innsending på en fredag. Derfor to lag: `typeof window`-vakten
// under unngår kast-stien helt, og try/catch er backstoppen for alt annet
// (biblioteket kaster også fra `parseProperties` på ugyldige verdier i dev).
//
// ── KRAV 2: INERT UTEN KONFIGURASJON, UTEN STØY ────────────────────────────
// Biblioteket kaller `window.va?.('event', …)` — et VALGFRITT kall. Er Web
// Analytics-skriptet ikke lastet (analytics avslått i dashbordet, en
// blokkerende utvidelse, lokal `npm run dev`), finnes `window.va` ikke, og
// kallet er en ren no-op uten feil og uten logging. Vi trenger altså ingen
// egen funksjonsbryter: fraværet av skriptet ER bryteren, på samme måte som
// fraværet av NEXT_PUBLIC_SENTRY_DSN gjør Sentry inert.
//
// ── KRAV 4: NULL LATENS I KRITISK STI ─────────────────────────────────────
// `spor()` returnerer `void`, ikke en Promise, og kan derfor ikke `await`es ved
// et uhell. `track()` fra `@vercel/analytics` (klient) er synkron fire-and-
// forget — den legger hendelsen i køen og returnerer. Serverside-varianten
// `@vercel/analytics/server` returnerer en Promise som MÅ awaites, og er
// nettopp derfor bevisst ikke brukt: den ville lagt et nettverkskall foran
// responsen spilleren venter på.

import { track } from '@vercel/analytics'
import { decideAnalyticsEvent, type SporingsInput } from './analytics-event'

/**
 * Send én traktmåling. Kan ikke kaste, kan ikke blokkere, kan ikke lekke.
 *
 * Returtypen er `void` MED VILJE — ikke `Promise<void>`. Det er den mekaniske
 * garantien bak kravet om null latens i kritisk sti: et kallsted kan ikke
 * `await` seg til en forsinkelse foran en innsending.
 */
export function spor(input: SporingsInput): void {
  try {
    // Serverside-render, eller et hvilket som helst ikke-nettleser-miljø: ut
    // før vi rører biblioteket. Dette er lag 1 mot kast-stien over.
    if (typeof window === 'undefined') return

    const beslutning = decideAnalyticsEvent(input)
    if (!beslutning.send) return

    track(beslutning.navn, beslutning.properties)
  } catch {
    // Med vilje helt stille. Ingen console.error, ingen Sentry-melding:
    // en måling som feiler er ikke en hendelse spilleren eller Dennis kan
    // gjøre noe med, og et varsel per innsending ville vært støy i nettopp
    // det minuttet 400 personer spiller samtidig. Samme avveining som
    // «sjeldne tekniske feil: varsle ikke spilleren» — her når ikke engang
    // Dennis kan handle på det, så det logges ingen steder.
  }
}
