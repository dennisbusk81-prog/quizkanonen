'use server'

import { headers } from 'next/headers'
import { timingSafeEqual } from 'crypto'
import { rateLimit } from './rate-limit'
import { createAdminToken } from './admin-token'

// ── Admin-innlogging ─────────────────────────────────────────────────────────
// Tidligere var dette en naken `password === adminPassword` uten noen form for
// begrensning: en angriper kunne kalle server-actionen ubegrenset og gjette
// passordet i ro og mak. Nå:
//
//   • maks 5 forsøk per IP per 15 minutter (samme delte rate-limit som brukes på
//     andre sensitive endepunkter, f.eks. check-email og start-attempt)
//   • timing-safe sammenligning, så responstiden ikke lekker hvor mange tegn
//     som stemmer
//   • ved suksess returneres et signert, tidsbegrenset token — passordet lagres
//     ALDRI i nettleseren
//
// Merk at rate-limit-lageret er per serverless-instans (modul-nivå Map). Det
// gjør begrensningen mindre eksakt under høy samtidighet, men admin-login har i
// praksis én bruker — og selv en delvis sperre gjør ubegrenset gjetting umulig.

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

  if (!rateLimit(`admin-login:${ip}`, MAX_ATTEMPTS, WINDOW_MS).success) {
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
