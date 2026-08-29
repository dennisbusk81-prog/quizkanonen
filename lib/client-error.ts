// Feil er ikke tomt — KLIENTENS versjon.
//
// lib/home-query-guard.ts gjør dette server-side: leser feilen, skriver den til
// loggen, og lar kalleren degradere synlig. Klienten har manglet motstykket.
// Et sveip 29. august 2026 talte 190 catch-blokker i de 83 klientfilene:
//
//                        catch   m/console   m/Sentry   HELT stumme
//   alle klientfiler      190       26          0          164
//   app/admin/**           64       21          0           43
//   spillerflater         126        5          0          121
//
// På flatene der ekte brukere er, produserte altså 121 av 126 fangede feil
// INGENTING — ikke en loggnlinje, ikke et event. De 5 som skrev console.error
// skrev til den besøkendes egen nettleserkonsoll, som Dennis aldri ser.
//
// Merk hva som IKKE var galt: `GlobalHandlers` står i SDK-ens default-sett, så
// UFANGEDE feil og unhandled rejections har hele tiden nådd Sentry. Hullet er
// presist de HÅNDTERTE feilene — og en React error boundary er det verste
// tilfellet, fordi den med vilje stopper feilen fra å nå window.onerror.
//
// HVORFOR IKKE captureConsole-integrasjonen: den finnes i @sentry/nextjs
// 10.69.0 og ville vært én linje. Men den avlytter console-kanalen, og den
// kanalen er tom på 121 av 126 spillervendte catch-blokker. Den ville dekket
// 4 %, og samtidig sluppet inn ALL tredjeparts console.error i sidekonteksten
// — én React hydration-mismatch på forsiden logger én gang per sidelast og
// spiser månedskvoten alene.
//
// KONSOLLEN BEHOLDES, den erstattes ikke. SENTRY_ENABLED er false lokalt uten
// NEXT_PUBLIC_SENTRY_ENABLE_IN_DEV=1, så en helper som bare sendte til Sentry
// ville gjort `npm run dev` blind — nøyaktig feilklassen vi fjerner, bare
// flyttet til utviklingsmaskinen.

import * as Sentry from '@sentry/nextjs'

/** Sendinger per `area` per sidelast. */
export const MAX_PER_AREA = 3
/** Sendinger totalt, på tvers av alle areas, per sidelast. */
export const MAX_TOTAL = 8

export type ThrottleDecision = 'send' | 'area-capped' | 'total-capped'

export interface ThrottleState {
  perArea: Map<string, number>
  total: number
}

export function createThrottleState(): ThrottleState {
  return { perArea: new Map(), total: 0 }
}

/**
 * Dempingen. Ren funksjon, muterer `state` på stedet.
 *
 * HVA DEN BINDER, OG HVA DEN IKKE GJØR — dette skillet er poenget:
 *
 * Telleren lever på modulnivå i ÉN nettleserfane. Den kan derfor ikke gjøre
 * noe med at 60 spillere krasjer samtidig; hver av dem har sin egen ferske
 * teller. Det den binder er det som faktisk er ubundet: én fane som looper.
 * En retry-sløyfe eller en re-render-storm kan ellers fyre hundrevis av
 * events fra én enhet.
 *
 * Regnestykket: taket per fane er MAX_TOTAL = 8. En Supabase-utetid med 60
 * samtidige spillere koster da høyst 60 × 8 = 480 events mot en månedskvote
 * på 5000. Uten taket er samme utetid ubundet.
 *
 * INGEN TIDSVINDU — bevisst. Et vindu ville nullstilt telleren og gjort taket
 * til «8 per vindu» i stedet for «8, punktum»: en fane som står åpen i en time
 * under utetid ville da kostet 6 × 8, og de 60 spillerne 2880 — over halve
 * månedskvoten. Prisen er at en fane går stum etter 8 rapporter. Den prisen er
 * riktig her: vi mister ikke signalet, for de 59 andre fanene rapporterer sine
 * egne 8. Å se den samme feilen en 9. gang fra samme enhet er verdiløst.
 *
 * `perArea` teller FORSØK (så vi vet når taket er nådd), `total` teller
 * SENDINGER (for det er sendinger som koster kvote). Derfor økes `total` kun
 * på 'send' — ellers ville en area som er dempet spist av totalbudsjettet til
 * de andre.
 */
export function decideClientErrorReport(state: ThrottleState, area: string): ThrottleDecision {
  const seen = state.perArea.get(area) ?? 0
  state.perArea.set(area, seen + 1)

  if (seen >= MAX_PER_AREA) return 'area-capped'
  if (state.total >= MAX_TOTAL) return 'total-capped'

  state.total += 1
  return 'send'
}

const state = createThrottleState()

/**
 * Logg en fanget klientfeil. Skriver ALLTID til konsollen, og sender til
 * Sentry så lenge dempingen tillater det.
 *
 * `area` blir Sentry-taggen, samme form som app/page.tsx sin
 * `tags: { area: 'home-page-insights' }`. Hold den FLAT og lav-kardinalitet —
 * ikke lim inn quiz-id eller brukernavn. Hvilken side feilen skjedde på ligger
 * allerede i eventet: `HttpContext` er en default-integrasjon og setter
 * request.url fra window.location, og scrubUrl vasker den.
 */
export function logClientError(area: string, err: unknown): void {
  const decision = decideClientErrorReport(state, area)

  if (decision !== 'send') {
    console.error(`[${area}] (dempet: ${decision} — ikke sendt til Sentry)`, err)
    return
  }

  console.error(`[${area}]`, err)
  try {
    Sentry.captureException(err, { tags: { area } })
  } catch {
    // Rapporteringen kan ikke rapportere sin egen svikt. Samme mønster som
    // app/page.tsx og lib/opened-quiz-lookup: siden skal ikke falle fordi
    // Sentry er nede.
  }
}
