import { createHmac, timingSafeEqual } from 'crypto'

// ── Signert, tidsbegrenset admin-sesjonstoken ────────────────────────────────
// Server-only (bruker node:crypto og ADMIN_PASSWORD).
//
// BAKGRUNN: nettleseren lagret tidligere selve admin-passordet i klartekst i
// sessionStorage ('qk_admin_pw') og sendte det på hvert API-kall. Enhver
// DevTools-tilgang eller XSS ga dermed varig, full admin-tilgang.
//
// Nå: passordet sendes ÉN gang ved innlogging. Serveren svarer med et token som
// er HMAC-signert og bærer sitt eget utløpstidspunkt. Kompromitteres tokenet,
// utløper det av seg selv — og det kan ikke brukes til å utlede passordet.
//
// Nøkkelen er ADMIN_PASSWORD selv. Det er en server-only hemmelighet som
// allerede finnes, så vi slipper en ny miljøvariabel som må settes i Vercel før
// deploy. Bonus: endres passordet, blir alle utstedte tokens ugyldige umiddelbart.
// (Vil vi senere skille nøklene, kan en egen ADMIN_TOKEN_SECRET legges til her
// uten at noe annet må endres.)
//
// Format: "<utløp-i-ms>.<base64url-signatur>". Utløpet inngår i det signerte
// materialet, så en manipulert utløpsdato gir ugyldig signatur.

const SESSION_MS = 8 * 60 * 60 * 1000 // 8 timer — samme varighet som før

function signingKey(): string | null {
  return process.env.ADMIN_PASSWORD || null
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

export function createAdminToken(): string | null {
  const key = signingKey()
  if (!key) return null
  const exp = String(Date.now() + SESSION_MS)
  return `${exp}.${sign(exp, key)}`
}

export function verifyAdminToken(token: string): boolean {
  const key = signingKey()
  if (!key) return false

  const dot = token.indexOf('.')
  if (dot <= 0) return false

  const exp = token.slice(0, dot)
  const providedSig = token.slice(dot + 1)
  if (!providedSig) return false

  // Signatur først: en ugyldig signatur skal aldri kunne skilles fra en utløpt
  // ved hjelp av responstid eller rekkefølge.
  const expectedSig = sign(exp, key)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length) return false
  if (!timingSafeEqual(a, b)) return false

  const expMs = Number(exp)
  if (!Number.isFinite(expMs)) return false
  return Date.now() <= expMs
}

// Eksponeres slik at klienten kan vise/håndtere utløp uten å parse selv.
export const ADMIN_SESSION_MS = SESSION_MS
