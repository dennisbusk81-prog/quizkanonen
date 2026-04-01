import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  let body: { id?: string; display_name?: string | null; avatar_color?: string | null }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { id, display_name, avatar_color } = body

  if (!id) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('profiles').upsert(
    { id, display_name: display_name ?? null, avatar_color: avatar_color ?? null, last_seen_at: new Date().toISOString() },
    { onConflict: 'id' }
  )

  if (error) {
    console.error('[api/profile/upsert] failed:', error.code, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
