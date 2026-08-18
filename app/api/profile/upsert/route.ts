import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'

const bodySchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  display_name: z
    .string()
    .trim()
    .min(2, 'Navn må være minst 2 tegn')
    .max(40, 'Navn kan maks være 40 tegn')
    .regex(/^[\p{L}\s\-']{2,40}$/u, 'Navnet kan bare inneholde bokstaver, mellomrom, bindestrek og apostrof'),
  avatar_color: z.string().nullable().optional(),
  show_member_number: z.boolean().optional(),
  age_confirmed_at: z.string().datetime().optional(),
  email_reminders: z.boolean().optional(),
  nickname: z
    .string()
    .trim()
    .max(20, 'Kallenavn kan maks være 20 tegn')
    .nullable()
    .optional(),
})

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `profile-upsert:${ip}`
  const rl = rateLimit(rlKey, 10, 60_000)
  if (!rl.success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 10, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  // FIX 1 — require auth and verify ownership
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e: { message: string }) => e.message).join(', ')
    return NextResponse.json({ error: message }, { status: 422 })
  }

  // FIX 1 — ensure caller can only update their own profile
  if (user.id !== parsed.data.id) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const { id, display_name, avatar_color, show_member_number, age_confirmed_at, email_reminders, nickname } = parsed.data

  // Full name required: must contain a space or hyphen (Anne-Marie counts)
  const hasFullName = display_name.trim().includes(' ') || display_name.trim().includes('-')
  if (!hasFullName) {
    return NextResponse.json({ error: 'Vennligst bruk ditt fulle navn (fornavn og etternavn)' }, { status: 400 })
  }

  const upsertData: Record<string, unknown> = {
    id,
    display_name,
    last_seen_at: new Date().toISOString(),
  }
  if (avatar_color !== undefined) {
    upsertData.avatar_color = avatar_color
  }
  if (show_member_number !== undefined) {
    upsertData.show_member_number = show_member_number
  }
  if (age_confirmed_at !== undefined) {
    upsertData.age_confirmed_at = age_confirmed_at
  }
  if (email_reminders !== undefined) {
    upsertData.email_reminders = email_reminders
  }
  if (nickname !== undefined) {
    // Tom streng lagres som null (intet kallenavn)
    const trimmed = nickname?.trim() ?? ''
    upsertData.nickname = trimmed === '' ? null : trimmed
  }

  const { error } = await supabaseAdmin.from('profiles').upsert(
    upsertData,
    { onConflict: 'id' }
  )

  if (error) {
    // Navnekollisjon er et forventet brukerutfall, ikke en systemfeil — logges
    // som warn så det ikke drukner de reelle feilene i profils-ruten.
    if (error.code === '23505') {
      console.warn('[api/profile/upsert] navnet er opptatt:', display_name)
      // Meldingen vises ordrett av både NameRequiredModal og profilsiden.
      // «Velg et annet» duger ikke: den som får denne har som regel skrevet
      // sitt EGET navn, og modalen slipper deg ikke videre før den godtar
      // noe. Eksempelet må bruke mellomnavn, ikke forbokstav med punktum —
      // navneregexen over tillater ikke punktum og ville avvist forslaget.
      return NextResponse.json(
        {
          error:
            `Navnet «${display_name}» er allerede i bruk av en annen spiller. ` +
            'Legg til mellomnavnet ditt for å skille dere — for eksempel «Ola Magnus Nordmann».',
        },
        { status: 409 }
      )
    }
    console.error('[api/profile/upsert] failed:', error.code, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
