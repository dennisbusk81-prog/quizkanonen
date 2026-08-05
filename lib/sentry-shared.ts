// ── Felles Sentry-innstillinger for klient, server og edge ───────────────────
// Ett sted for verdier som MÅ være like i alle tre initene. Sample rate, release
// og miljønavn som spriker mellom runtime-ene gir tall som ikke lar seg
// sammenligne, og en release-streng som ikke matcher den source maps ble lastet
// opp under gir uleselige stack traces akkurat når man trenger dem.

/**
 * Andel forespørsler som får full ytelses-sporing.
 *
 * 15 % er valgt ut fra faktisk volum: gratisplanen tåler 5000 events/mnd, og
 * trafikken er lav med en skarp topp rundt fredagsquizen. 100 % ville brent
 * kvoten på støy fra normal drift og gjort at ekte feil ble kastet vekk når
 * kvoten var oppbrukt. Feil (exceptions) er IKKE berørt av denne — de sendes
 * alltid, 100 %. Dette gjelder kun ytelses-transaksjoner.
 */
export const TRACES_SAMPLE_RATE = 0.15

/**
 * Release-navnet feil grupperes under. Vercel eksponerer commit-SHA-en i to
 * varianter: den NEXT_PUBLIC-prefiksede er den eneste som overlever inn i
 * klient-bundelen, siden Next kun inliner variabler med det prefikset.
 * Faller tilbake på undefined lokalt — da grupperer Sentry uten release.
 */
export const SENTRY_RELEASE =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  undefined

/** 'production' | 'preview' | 'development' — skiller prod-feil fra preview-støy. */
export const SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_VERCEL_ENV ||
  process.env.VERCEL_ENV ||
  'development'

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

/**
 * Sentry er på når det finnes en DSN OG vi enten kjører en ekte build, eller
 * har bedt eksplisitt om det lokalt.
 *
 * Grunnen til at lokal utvikling er av som standard: uten dette ville hver
 * `npm run dev` med DSN i .env.local sendt hver eneste HMR-feil og
 * halvskrevne-kode-krasj til produksjonsprosjektet, og spist kvoten som skal
 * fange ekte spillerfeil. Sett NEXT_PUBLIC_SENTRY_ENABLE_IN_DEV=1 når du
 * bevisst vil teste rørgata lokalt.
 */
export const SENTRY_ENABLED =
  Boolean(SENTRY_DSN) &&
  (process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_SENTRY_ENABLE_IN_DEV === '1')
