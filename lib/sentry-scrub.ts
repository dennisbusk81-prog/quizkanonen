// ── Skrubbing av data på vei ut til Sentry ───────────────────────────────────
// Ren logikk, ingen I/O — kjører identisk på klient, server og edge, og kalles
// fra beforeSend/beforeSendTransaction i alle tre Sentry-initene.
//
// BAKGRUNN: en feilmelding er fritekst, og fritekst i denne kodebasen kan bære
// e-postadresser (invitasjoner, ukesrapport, Stripe-kvitteringer), Bearer-token
// fra Supabase, Stripe live-nøkler og attempt-token. Sentry er en EKSTERN
// tjeneste — alt som havner der er delt ut av huset og kan ikke trekkes tilbake.
// Derfor skrubbes det ved SINKET (her), ikke hos hver kaller: da kan ingen
// framtidig `Sentry.captureException(...)` et sted i koden glemme det.
// Samme prinsipp som escapingen i lib/email-templates.ts (26. juli).
//
// To lag:
//   1. Mønsterbasert — e-post, JWT, Stripe-nøkler, Bearer. Fanger også ting vi
//      ikke visste at kunne lekke.
//   2. Bokstavelig — de faktiske verdiene av server-hemmelighetene i miljøet.
//      Fanger en hemmelighet som er formatert på en måte mønstrene ikke kjenner.
//      Lag 2 er tomt på klienten (der finnes ingen hemmeligheter i process.env),
//      og det er riktig — lag 1 gjelder uansett.

export const REDACTED = '[skrubbet]'

// Header-navn som ALDRI skal ut. `x-forwarded-for` er med fordi IP-adresse er
// personopplysning, ikke fordi den er en hemmelighet.
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-admin-token',
  'x-admin-password',
  'x-attempt-token',
  'stripe-signature',
  'x-forwarded-for',
  'x-real-ip',
  'x-vercel-forwarded-for',
])

// Query-parametere hvis VERDI skal skrubbes. Nøkkelen beholdes, så det er
// fortsatt synlig hvilken parameter som var i spill.
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'code',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
  'key',
  'secret',
  'password',
  'email',
  'session_id',
])

// Ruter der hemmeligheten ligger i STIEN, ikke i query. /api/org/join/<token>
// er den ene i dag; listen er et prefiks-match slik at siste segment byttes ut.
const SECRET_PATH_PREFIXES = ['/api/org/join/', '/org/join/']

// Miljøvariabler hvis verdi aldri skal forekomme i et event.
const SECRET_ENV_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ADMIN_PASSWORD',
  'CRON_SECRET',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'VAPID_PRIVATE_KEY',
  'QUIZ_TOKEN_SECRET',
  'SENTRY_AUTH_TOKEN',
  // Ping-URL-ene til healthchecks.io (lib/cron-heartbeat.ts): den som har
  // dem kan forfalske heartbeats. Lav verdi, men ingen grunn til å la dem
  // ligge i en fetch-feilmelding i et event.
  'HEALTHCHECK_PUBLISH_QUIZ_URL',
  'HEALTHCHECK_AWARD_SEASON_POINTS_URL',
]

const PATTERNS: ReadonlyArray<RegExp> = [
  // E-post. Bevisst grådig nok til å ta adresser midt i en setning.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // JWT — dekker Supabase anon/service-nøkler og brukernes access_token.
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Stripe-nøkler, både live og test.
  /\b(?:sk|rk|whsec|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  // Alt som presenterer seg som et Bearer-token.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
]

/**
 * Plukker ut de faktiske hemmelighets-VERDIENE fra et miljø. Kalles kun
 * server-/edge-side. Verdier kortere enn 8 tegn ignoreres: en kort verdi kan
 * være et vanlig ord, og å erstatte alle forekomster av den ville gjort
 * feilmeldinger uleselige uten å beskytte noe reelt.
 */
export function collectSecretValues(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  for (const key of SECRET_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && value.length >= 8) out.push(value)
  }
  // Lengste først: ellers kan en kort hemmelighet som er prefiks av en lang
  // skrubbe halve den lange og etterlate resten i klartekst.
  return out.sort((a, b) => b.length - a.length)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Skrubber fritekst: mønstre først, deretter bokstavelige hemmeligheter. */
export function scrubText(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED)
  for (const secret of secrets) {
    out = out.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED)
  }
  return out
}

/**
 * Skrubber en URL: hemmelige query-verdier, hemmelige sti-segmenter, og til
 * slutt fritekst-mønstrene på det som blir igjen. Ugyldige URL-er (relative
 * stier o.l.) faller tilbake på ren fritekst-skrubbing.
 */
export function scrubUrl(url: string, secrets: readonly string[] = []): string {
  let parsed: URL
  try {
    parsed = new URL(url, 'https://placeholder.invalid')
  } catch {
    return scrubText(url, secrets)
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.set(key, REDACTED)
  }

  for (const prefix of SECRET_PATH_PREFIXES) {
    if (parsed.pathname.startsWith(prefix)) {
      parsed.pathname = prefix + REDACTED
      break
    }
  }

  const rebuilt = parsed.origin === 'https://placeholder.invalid'
    ? parsed.pathname + parsed.search
    : parsed.toString()

  return scrubText(rebuilt, secrets)
}

// Strukturell type over de feltene vi faktisk rører. Bevisst ikke importert fra
// @sentry/nextjs: da forblir modulen avhengighetsfri og testbar uten SDK-en.
export interface ScrubbableEvent {
  message?: string
  request?: {
    url?: string
    headers?: Record<string, string>
    query_string?: unknown
    data?: unknown
  }
  exception?: { values?: Array<{ value?: string }> }
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>
  // ip_address er `string | null` hos Sentry — null betyr «ikke sett meg»,
  // og typen må speile det for at et ekte Event skal være tilordelbart hit.
  user?: { email?: string; username?: string; ip_address?: string | null }
  extra?: Record<string, unknown>
}

function scrubUnknown(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (depth > 6) return REDACTED
  if (typeof value === 'string') return scrubText(value, secrets)
  if (Array.isArray(value)) return value.map((v) => scrubUnknown(v, secrets, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_QUERY_KEYS.has(k.toLowerCase()) ? REDACTED : scrubUnknown(v, secrets, depth + 1)
    }
    return out
  }
  return value
}

/**
 * Skrubber et Sentry-event på stedet og returnerer det samme objektet.
 * Muterer bevisst: Sentry sitt beforeSend gir oss eventet og forventer det
 * tilbake, og en dyp kopi ville brutt referanser SDK-en selv holder på.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T, secrets: readonly string[] = []): T {
  if (typeof event.message === 'string') event.message = scrubText(event.message, secrets)

  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = scrubText(value.value, secrets)
  }

  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === 'string') crumb.message = scrubText(crumb.message, secrets)
    if (crumb.data) crumb.data = scrubUnknown(crumb.data, secrets) as Record<string, unknown>
  }

  if (event.request) {
    if (typeof event.request.url === 'string') event.request.url = scrubUrl(event.request.url, secrets)
    if (event.request.headers) {
      const headers = event.request.headers
      for (const name of Object.keys(headers)) {
        headers[name] = SENSITIVE_HEADERS.has(name.toLowerCase())
          ? REDACTED
          : scrubText(headers[name], secrets)
      }
    }
    if (event.request.query_string !== undefined) {
      event.request.query_string = typeof event.request.query_string === 'string'
        ? scrubUrl(`/?${event.request.query_string}`, secrets).replace(/^\/\?/, '')
        : scrubUnknown(event.request.query_string, secrets)
    }
    if (event.request.data !== undefined) {
      event.request.data = scrubUnknown(event.request.data, secrets)
    }
  }

  // Brukerkontekst: user.id (uuid) beholdes bevisst — den er det eneste som gjør
  // en feil sporbar til «hvem opplevde dette», og er verdiløs uten databasen.
  // E-post, brukernavn og IP fjernes helt i stedet for å skrubbes, slik at
  // Sentry ikke viser et «[skrubbet]» der et navn ville stått.
  if (event.user) {
    delete event.user.email
    delete event.user.username
    delete event.user.ip_address
  }

  if (event.extra) event.extra = scrubUnknown(event.extra, secrets) as Record<string, unknown>

  return event
}
