import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

export async function GET(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('site_settings')
    .select('founders_max_slots, founders_days_free, founders_trial_days')
    .maybeSingle()

  return NextResponse.json({
    maxSlots:  (data as Record<string, number> | null)?.founders_max_slots  ?? 250,
    daysFree:  (data as Record<string, number> | null)?.founders_days_free  ?? 30,
    trialDays: (data as Record<string, number> | null)?.founders_trial_days ?? 7,
  })
}

export async function PATCH(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { founders_max_slots, founders_days_free, founders_trial_days } = await request.json()

  const { error } = await supabaseAdmin
    .from('site_settings')
    .update({ founders_max_slots, founders_days_free, founders_trial_days })
    .not('id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
