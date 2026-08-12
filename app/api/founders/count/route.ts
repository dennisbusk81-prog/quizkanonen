import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Founders-innstillingene er data, ikke kode. Mangler en nøkkel i site_settings
// returnerer vi null i stedet for et oppdiktet tall: kallerne viser da tekst
// uten dagtall/plasstall, framfor å love noe som ikke er innstilt noe sted.
function readSetting(rows: { key: string; value: string }[], key: string): number | null {
  const raw = rows.find(r => r.key === key)?.value
  if (raw == null) return null
  const n = parseInt(raw)
  return Number.isFinite(n) ? n : null
}

export async function GET() {
  // Hent founders-innstillinger fra site_settings (key/value-tabell)
  const { data: rows } = await supabaseAdmin
    .from('site_settings')
    .select('key, value')
    .in('key', ['founders_max_slots', 'founders_days_free', 'founders_trial_days'])

  const settings = (rows ?? []) as { key: string; value: string }[]
  const maxSlots  = readSetting(settings, 'founders_max_slots')
  const daysFree  = readSetting(settings, 'founders_days_free')
  const trialDays = readSetting(settings, 'founders_trial_days')

  // Tell aktive founders/code-brukere — betalende (personal/org) teller ikke med
  const { count } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .in('premium_source', ['founders', 'code'])
    .eq('premium_status', true)

  const used = count ?? 0
  // Uten et innstilt tak kan vi hverken påstå «fullt» eller «plasser igjen».
  const isFull     = maxSlots !== null && used >= maxSlots
  const isFounders = maxSlots !== null && used < maxSlots
  const remaining  = maxSlots === null ? null : Math.max(0, maxSlots - used)

  return NextResponse.json({
    used,
    max:        maxSlots,
    remaining,
    isFull,
    daysFree:   isFounders ? daysFree : trialDays,
    isFounders,
  })
}
