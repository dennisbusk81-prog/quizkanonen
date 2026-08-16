import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Founders-innstillingene er data, ikke kode. Mangler en nøkkel i site_settings
// returnerer vi null i stedet for et oppdiktet tall: kallerne viser da tekst
// uten dagtall/plasstall, framfor å love noe som ikke er innstilt noe sted.
function readSetting(rows: { key: string; value: string }[], key: string): number | null {
  const raw = rows.find(r => r.key === key)?.value
  if (raw == null) return null
  // Samme strenghet som aktiveringsruten: bare et positivt heltall er et gyldig
  // tall å vise. `parseInt` ville godtatt «14abc» som 14.
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET() {
  // Hent founders-innstillinger fra site_settings (key/value-tabell)
  //
  // Dagtallet MÅ leses fra samme nøkkel som /api/stripe/founders-activate bruker.
  // Fram til 12. august 2026 leste denne ruten `founders_days_free` (30) og
  // `founders_trial_days` (7), mens aktiveringen hadde gått over til sin egen
  // nøkkel — knappen ville lovet 30 dager og brukeren fått noe annet. De to
  // gamle nøklene styrer nå ingenting utenfor admin-skjemaet.
  const { data: rows } = await supabaseAdmin
    .from('site_settings')
    .select('key, value')
    .in('key', ['founders_max_slots', 'founders_new_trial_days'])

  const settings = (rows ?? []) as { key: string; value: string }[]
  const maxSlots = readSetting(settings, 'founders_max_slots')
  // Ingen fallback: mangler nøkkelen, er svaret null, og kallerne viser tekst
  // uten dagtall. Å gjette her ville gjeninnført nøyaktig divergensen over.
  const trialDays = readSetting(settings, 'founders_new_trial_days')

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
    // Feltnavnet er beholdt (`/founders` leser det), men verdien er nå den ENE
    // prøvelengden — ikke lenger avhengig av om det er ledige plasser.
    daysFree:   trialDays,
    isFounders,
  })
}
