import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  // Hent founders-innstillinger fra site_settings (key/value-tabell)
  const { data: rows } = await supabaseAdmin
    .from('site_settings')
    .select('key, value')
    .in('key', ['founders_max_slots', 'founders_days_free', 'founders_trial_days'])

  const settings = Object.fromEntries(
    (rows ?? []).map(r => [r.key, parseInt(r.value as string)])
  )
  const maxSlots  = settings.founders_max_slots  ?? 250
  const daysFree  = settings.founders_days_free  ?? 30
  const trialDays = settings.founders_trial_days ?? 7

  // Tell aktive founders/code-brukere — betalende (personal/org) teller ikke med
  const { count } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .in('premium_source', ['founders', 'code'])
    .eq('premium_status', true)

  const used      = count ?? 0
  const isFull    = used >= maxSlots
  const remaining = Math.max(0, maxSlots - used)
  const isFounders = !isFull

  return NextResponse.json({
    used,
    max:        maxSlots,
    remaining,
    isFull,
    daysFree:   isFounders ? daysFree : trialDays,
    isFounders,
  })
}
