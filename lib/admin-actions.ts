'use server'

import { headers } from 'next/headers'
import { timingSafeEqual } from 'crypto'
import { rateLimitShared } from './rate-limit-shared'
import { logRateLimitHit } from './rate-limit-log'
import { createAdminToken } from './admin-token'

// ── Admin-innlogging ─────────────────────────────────────────────────────────
// Tidligere var dette en naken `password === adminPassword` uten noen form for
// begrensning: en angriper kunne kalle server-actionen ubegrenset og gjette
// passordet i ro og mak. Nå:
//
//   • maks 5 forsøk per IP per 15 minutter, med DELT teller (se
//     lib/rate-limit-shared.ts)
//   • timing-safe sammenligning, så responstiden ikke lekker hvor mange tegn
//     som stemmer
//   • ved suksess returneres et signert, tidsbegrenset token — passordet lagres
//     ALDRI i nettleseren
//
// Telleren lå fram til 5. august 2026 i en Map per serverless-instans. Vinduet
// her er 15 minutter — lengre enn levetiden til en instans — så telleren kunne
// forsvinne midt i vinduet helt uten samtidighet, og en gjetter som traff nye
// instanser fikk stadig ferske forsøk. For nettopp passordgjetting er det den
// svakeste varianten av sperren som teller, og derfor er dette kallstedet
// blant dem som er flyttet til delt lagring.

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

export type AdminLoginResult =
  | { ok: true; token: string }
  | { ok: false; error: string; lockedOut?: boolean }

export async function verifyAdminPassword(password: string): Promise<AdminLoginResult> {
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    return { ok: false, error: 'Admin-pålogging er ikke konfigurert.' }
  }

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  const rlKey = `admin-login:${ip}`
  if (!(await rateLimitShared(rlKey, MAX_ATTEMPTS, WINDOW_MS)).success) {
    logRateLimitHit(rlKey, { lag: 'delt', limit: MAX_ATTEMPTS, windowMs: WINDOW_MS })
    return {
      ok: false,
      lockedOut: true,
      error: 'For mange forsøk. Vent 15 minutter og prøv igjen.',
    }
  }

  const a = Buffer.from(password)
  const b = Buffer.from(adminPassword)
  const match = a.length === b.length && timingSafeEqual(a, b)

  if (!match) {
    return { ok: false, error: 'Feil passord. Prøv igjen.' }
  }

  const token = createAdminToken()
  if (!token) {
    return { ok: false, error: 'Kunne ikke opprette sesjon. Prøv igjen.' }
  }

  return { ok: true, token }
}
