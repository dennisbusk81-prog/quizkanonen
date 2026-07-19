import { timingSafeEqual } from 'crypto'
import { verifyAdminToken } from './admin-token'

// Timing-safe sammenligning av to strenger. Returnerer false ved ulik lengde
// (timingSafeEqual krever like lange buffere).
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// Server-side: verifiser at en forespørsel har admin-tilgang.
//
// Legitimasjonen hentes (i prioritert rekkefølge) fra:
//   1. x-admin-token-header      — det nettleseren sender etter innlogging
//   2. x-admin-password-header   — historisk navn, bærer nå token (se under)
//   3. Authorization: Bearer <…>
//
// TO GYLDIGE FORMER, bevisst:
//   a) Et signert sesjonstoken (lib/admin-token.ts). Dette er det nettleseren
//      bruker — passordet forlater aldri innloggingsskjemaet.
//   b) Selve ADMIN_PASSWORD, timing-safe sammenlignet. Beholdt fordi manuelle
//      operasjoner går denne veien, f.eks. den dokumenterte curl-kommandoen i
//      app/api/admin/org-resend-purchase/route.ts. Passordet ER master-
//      legitimasjonen, så å akseptere det direkte svekker ingenting — poenget
//      med endringen er at nettleseren slutter å LAGRE det.
//
// Rekkefølgen betyr at eksisterende innloggede admin-økter (som fortsatt sender
// råpassordet fra sessionStorage) fungerer uendret til de logger inn på nytt.
//
// Body leses ikke her: funksjonen er synkron, og å konsumere request-strømmen
// ville brutt handlere som selv kaller await req.json() etterpå.
export function verifyAdminRequest(req: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) return false

  const authHeader = req.headers.get('authorization') ?? ''
  const fromBearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null

  const provided =
    req.headers.get('x-admin-token') ??
    req.headers.get('x-admin-password') ??
    fromBearer
  if (!provided) return false

  // Signert sesjonstoken (normalveien fra nettleseren)
  if (verifyAdminToken(provided)) return true

  // Råpassord (manuelle curl-operasjoner + eldre, ennå ikke fornyede økter)
  return safeEqual(provided, expected)
}

export function setAdminSession(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('qk_admin', 'true')
    localStorage.setItem('qk_admin_time', Date.now().toString())
  } catch {
    // Ignorer feil (f.eks. privat modus eller quota)
  }
}

export function isAdminLoggedIn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const isAdmin = localStorage.getItem('qk_admin')
    const loginTime = localStorage.getItem('qk_admin_time')
    if (!isAdmin || !loginTime) return false
    const eightHours = 8 * 60 * 60 * 1000
    return Date.now() - parseInt(loginTime) < eightHours
  } catch {
    return false
  }
}

// Lagrer det signerte sesjonstokenet fra innloggingen. Erstatter den tidligere
// setAdminPassword(), som la SELVE passordet i klartekst i sessionStorage —
// lesbart ved enhver DevTools-tilgang eller XSS, og gyldig i all fremtid.
// Tokenet er signert, utløper av seg selv, og kan ikke brukes til å utlede
// passordet.
export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('qk_admin_token', token)
    // Rydd bort et eventuelt klartekst-passord fra en tidligere økt, slik at det
    // ikke blir liggende igjen etter at denne endringen er deployet.
    sessionStorage.removeItem('qk_admin_pw')
  } catch {
    // Ignorer feil (f.eks. privat modus eller quota)
  }
}

// Returnerer sesjonstokenet. Faller tilbake på det gamle klartekst-passordet
// hvis det ligger igjen fra en økt som startet før denne endringen — da
// fortsetter adminFetch å virke til neste innlogging, uten avbrudd.
// Fallbacken kan fjernes når alle økter er fornyet.
export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem('qk_admin_token') ?? sessionStorage.getItem('qk_admin_pw')
  } catch {
    return null
  }
}

export function logoutAdmin(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem('qk_admin')
    localStorage.removeItem('qk_admin_time')
    sessionStorage.removeItem('qk_admin_token')
    sessionStorage.removeItem('qk_admin_pw')
  } catch {
    // ignore
  }
}
