import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`notify-subscribe:${ip}`, 5, 60_000).success) {
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
