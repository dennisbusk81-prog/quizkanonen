import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

// next_quiz_at lå tidligere som en direkte anon-klient-upsert i
// app/admin/page.tsx. site_settings hadde åpne INSERT/UPDATE-policyer, så
// skrivingen var i praksis anonym — admin-sjekken var kun klient-side.
// Samme tabell styrer org_trial_days og founders_days_free, som brukes som
// trial_period_days mot Stripe (live mode). Ruten speiler founders-settings.

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('site_settings')
    .select('value')
    .eq('key', 'next_quiz_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ nextQuizAt: data?.value ?? null })
}

export async function PATCH(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { nextQuizAt } = await request.json()

  // site_settings.value er fritekst, og både forsiden og quiz-siden gjør
  // new Date(value) uten å sjekke resultatet. Valider her i stedet.
  const parsed = typeof nextQuizAt === 'string' ? new Date(nextQuizAt) : null
  if (!parsed || isNaN(parsed.getTime())) {
    return NextResponse.json({ error: 'Ugyldig dato' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('site_settings')
    .upsert(
      { key: 'next_quiz_at', value: parsed.toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
