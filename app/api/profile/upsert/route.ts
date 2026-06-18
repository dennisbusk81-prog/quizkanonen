import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'

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

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`profile-upsert:${ip}`, 10, 60_000)
  if (!rl.success) {
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
    console.error('[api/profile/upsert] failed:', error.code, error.message)
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Dette brukernavnet er allerede tatt. Velg et annet.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
