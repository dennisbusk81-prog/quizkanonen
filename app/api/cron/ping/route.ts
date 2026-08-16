import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// OVERFLØDIG SIDEN 14. JUNI 2026 (Supabase Pro pauses aldri). Kandidat for
// sletting, se QK_4. Ikke fjernet ennå i tilfelle brukt til ekstern
// overvåkning — cron-jobben i cron-job.org deaktiveres separat (utenfor
// kodebasen).
//
// Opprinnelig formål: keep-alive endpoint for Supabase free tier.
// Call every 5 minutes from an external cron service to prevent the project from pausing.
//
// Required environment variable (add in Vercel → Settings → Environment Variables):
//   CRON_SECRET = <a long random string you generate, e.g. openssl rand -hex 32>
//
// Invoke with:
//   GET https://<your-domain>/api/cron/ping
//   Authorization: Bearer <CRON_SECRET>

// Ren varmholder — gjør ingen jobb. Uten eksplisitt tak arves plattform-
// defaulten på 300 s (Pro + Fluid, målt 14. august 2026).
export const maxDuration = 10

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabaseAdmin
    .from('site_settings')
    .select('*')
    .limit(1)

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() })
}
