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

// ── Klientdelen er FLYTTET til lib/admin-session.ts (12. august 2026) ────────
//
// `setAdminSession`, `isAdminLoggedIn`, `setAdminToken`, `getAdminToken` og
// `logoutAdmin` lå her, i samme fil som `verifyAdminRequest`. Denne filen
// importerer `node:crypto` og leser `ADMIN_PASSWORD`, mens de fem funksjonene
// ble importert av fjorten klientkomponenter. At hemmeligheten ikke havnet i
// nettleserbundelen skyldtes tree-shaking — en optimalisering, ikke en garanti.
//
// `setAdminSession` finnes ikke lenger i det hele tatt: localStorage-flagget
// den satte (`qk_admin`) var en andre kilde til en sannhet tokenet allerede
// bærer, og de to kunne dø hver for seg. Se lib/admin-session.ts.
//
// Denne filen er nå server-only og har én eksport. De 37 API-rutene som bruker
// `verifyAdminRequest` er upåvirket.
