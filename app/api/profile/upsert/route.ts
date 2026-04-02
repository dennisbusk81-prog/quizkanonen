import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'

const bodySchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  display_name: z
    .string()
    .trim()
    .min(1, 'display_name cannot be empty')
    .max(50, 'display_name max 50 characters'),
  avatar_color: z.string().nullable().optional(),
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`profile-upsert:${ip}`, 10, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
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

  const { id, display_name, avatar_color } = parsed.data

  const { error } = await supabaseAdmin.from('profiles').upsert(
    {
      id,
      display_name,
      avatar_color: avatar_color ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  )

  if (error) {
    console.error('[api/profile/upsert] failed:', error.code, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
