import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

// POST /api/org/trial-code/validate — sjekk en promo-kode på registreringssiden.
// Returnerer pakke + trial-dager hvis koden er gyldig og ubrukt. Markerer IKKE
// koden som brukt — det skjer først ved innløsning i org-founders-activate.
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`trial-code-validate:${ip}`, 15, 60_000).success) {
    return NextResponse.json({ error: 'For mange forsøk. Prøv igjen om litt.' }, { status: 429 })
  }

  let body: { code?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const code = body.code?.trim().toUpperCase()
  if (!code) return NextResponse.json({ error: 'Mangler kode' }, { status: 400 })

  const { data: row } = await supabaseAdmin
    .from('org_trial_codes')
    .select('code, package, trial_days, used_at')
    .eq('code', code)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ valid: false, error: 'Ukjent kode.' }, { status: 404 })
  }
  if (row.used_at) {
    return NextResponse.json({ valid: false, error: 'Koden er allerede brukt.' }, { status: 409 })
  }

  return NextResponse.json({ valid: true, package: row.package, trial_days: row.trial_days })
}
