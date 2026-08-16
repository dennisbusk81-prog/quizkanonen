import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimitShared } from '@/lib/rate-limit-shared'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!(await rateLimitShared(`notify-subscribe:${ip}`, 5, 60_000)).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  let body: { email?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Ugyldig e-postadresse' }, { status: 400 })
  }

  // Upsert — UNIQUE constraint on email means duplicate is silently ignored
  await supabaseAdmin
    .from('quiz_notifications')
    .upsert({ email }, { onConflict: 'email', ignoreDuplicates: true })

  return NextResponse.json({ ok: true })
}
