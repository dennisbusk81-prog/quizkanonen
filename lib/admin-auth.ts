import { timingSafeEqual } from 'crypto'

// Timing-safe sammenligning av to strenger. Returnerer false ved ulik lengde
// (timingSafeEqual krever like lange buffere).
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// Server-side: verifiser at en forespørsel bærer gyldig admin-passord.
// Passordet hentes (i prioritert rekkefølge) fra:
//   1. x-admin-password-header  — måten frontend sender det på i dag
//   2. Authorization: Bearer <passord>
//   3. ?password=<passord> query-parameter
// Sammenlignes timing-safe mot ADMIN_PASSWORD. Body leses ikke her: funksjonen
// er synkron og å konsumere request-strømmen ville brutt handlere som selv
// kaller await req.json() etterpå.
export function verifyAdminRequest(req: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) return false

  const fromHeader = req.headers.get('x-admin-password')

  const authHeader = req.headers.get('authorization') ?? ''
  const fromBearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null

  let fromQuery: string | null = null
  try {
    fromQuery = new URL(req.url).searchParams.get('password')
  } catch {
    fromQuery = null
  }

  const provided = fromHeader ?? fromBearer ?? fromQuery
  if (!provided) return false

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

export function setAdminPassword(password: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('qk_admin_pw', password)
  } catch {
    // ignore
  }
}

export function getAdminPassword(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem('qk_admin_pw')
  } catch {
    return null
  }
}

export function logoutAdmin(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem('qk_admin')
    localStorage.removeItem('qk_admin_time')
    sessionStorage.removeItem('qk_admin_pw')
  } catch {
    // ignore
  }
}
