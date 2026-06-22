import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows } = await supabaseAdmin
    .from('site_settings')
    .select('key, value')
    .in('key', ['founders_max_slots', 'founders_days_free', 'founders_trial_days'])

  const settings = Object.fromEntries(
    (rows ?? []).map(r => [r.key, parseInt(r.value as string)])
  )

  return NextResponse.json({
    maxSlots:  settings.founders_max_slots  ?? 250,
    daysFree:  settings.founders_days_free  ?? 30,
    trialDays: settings.founders_trial_days ?? 7,
  })
}

export async function PATCH(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { founders_max_slots, founders_days_free, founders_trial_days } = await request.json()

  const upserts = [
    { key: 'founders_max_slots',  value: String(founders_max_slots) },
    { key: 'founders_days_free',  value: String(founders_days_free) },
    { key: 'founders_trial_days', value: String(founders_trial_days) },
  ]

  const { error } = await supabaseAdmin
    .from('site_settings')
    .upsert(upserts, { onConflict: 'key' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
