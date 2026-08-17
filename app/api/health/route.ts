import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Uautentisert helsesjekk for ekstern overvåkning. Ingen CRON_SECRET —
// meningen er at hvem som helst (eller en ekstern uptime-tjeneste) skal
// kunne spørre den uten hemmelighet. Svarer KUN med {ok}, aldri detaljer
// (feilmelding, tidsstempel med DB-info e.l.) — se ARBEIDSREGEL i
// .claude/CLAUDE.md om at feilrapporter ikke skal lekke internals.
//
// Plattform-defaulten er 300 s (Pro + Fluid) uten eksplisitt tak — samme
// mønster som app/api/cron/ping/route.ts.
export const maxDuration = 10

// ── Rate-limit, IN-MEMORY, modul-lokal (bevisst IKKE lib/rate-limit.ts og
// IKKE Upstash) ──────────────────────────────────────────────────────────
// Denne ruten kalles typisk 1 gang per 5 minutter av en ekstern overvåker.
// 30 per 60 sekunder er romslig polstring, ikke en reell grense. Formålet
// er kun å hindre at ruten selv blir et mål for spam mot databasen — ved
// overskridelse svares 429 UTEN å røre databasen i det hele tatt.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30
const hits = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(key: string): boolean {
  const now = Date.now()

  // Enkel opprydding ved hvert oppslag, så Mapen ikke vokser ubegrenset —
  // ingen egen cron eller timer trengs for dette.
  for (const [k, v] of hits) {
    if (v.resetAt <= now) hits.delete(k)
  }

  const entry = hits.get(key)
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }

  entry.count += 1
  return entry.count > RATE_LIMIT_MAX
}

function noStore(body: { ok: boolean }, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

// VIKTIG: ingen throw skal noensinne slippe ut av denne handleren, og filen
// importerer bevisst ikke @sentry/nextjs. Sentrys onRequestError (se
// instrumentation.ts) fyrer kun på UKASTEDE feil — «aldri throw herfra» er
// derfor selve mekanismen, ikke en ekstra forsiktighetsregel.
//
// Bakgrunn: en ekstern sjekk hvert 5. minutt gir 24 treff over et
// to-timers utfall. Sentry-planen er 5000 hendelser/måned, og denne
// detektoren skal ikke spise budsjettet til den andre feilovervåkningen
// (Sentry selv) midt i den samme hendelsen begge finnes for å varsle om.
export async function GET(request: NextRequest) {
  try {
    const forwardedFor = request.headers.get('x-forwarded-for')
    const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown'

    if (isRateLimited(ip)) {
      return noStore({ ok: false }, 429)
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<{ timedOut: true }>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ timedOut: true }), 3000)
    })

    const probe = supabaseAdmin
      .from('site_settings')
      .select('*')
      .limit(1)
      .then(({ error }) => ({ timedOut: false as const, error }))

    const result = await Promise.race([probe, timeout])
    clearTimeout(timeoutHandle)

    if (result.timedOut || result.error) {
      return noStore({ ok: false }, 503)
    }

    return noStore({ ok: true }, 200)
  } catch {
    // Backstop: uansett hva som går galt over, skal ruten svare kontrollert
    // og aldri kaste videre til Next/Sentry.
    return noStore({ ok: false }, 503)
  }
}
