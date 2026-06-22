import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

const VALID_PACKAGES = ['starter', 'standard', 'pro'] as const

// Lesbar 8-tegns kode uten lett forvekslelige tegn (0/O, 1/I/L).
function randomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

// POST /api/admin/org-trial-codes/generate — opprett en ny engangskode for B2B-trial.
// Body: { package, trial_days, note?, code? }. Genererer kode hvis ingen oppgis.
export async function POST(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { package?: string; trial_days?: number; note?: string; code?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const pkg = body.package
  if (!pkg || !VALID_PACKAGES.includes(pkg as typeof VALID_PACKAGES[number])) {
    return NextResponse.json({ error: 'Ugyldig pakke' }, { status: 400 })
  }

  const trialDays = Number(body.trial_days)
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365) {
    return NextResponse.json({ error: 'Ugyldig antall trial-dager' }, { status: 400 })
  }

  // Tillat egendefinert kode (f.eks. PILOT-ELKJOP), ellers generér en.
  const code = body.code?.trim()
    ? body.code.trim().toUpperCase()
    : randomCode()

  const { data, error } = await supabaseAdmin
    .from('org_trial_codes')
    .insert({
      code,
      package: pkg,
      trial_days: trialDays,
      created_by_note: body.note?.trim() || null,
    })
    .select('id, code, package, trial_days, created_at, used_at, used_by_org_id, created_by_note')
    .single()

  if (error) {
    // Unik-kollisjon på code → 409
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Koden finnes allerede. Velg en annen.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
