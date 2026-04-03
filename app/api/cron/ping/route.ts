import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Keep-alive endpoint for Supabase free tier.
// Call every 5 minutes from an external cron service to prevent the project from pausing.
//
// Required environment variable (add in Vercel → Settings → Environment Variables):
//   CRON_SECRET = <a long random string you generate, e.g. openssl rand -hex 32>
//
// Invoke with:
//   GET https://<your-domain>/api/cron/ping
//   Authorization: Bearer <CRON_SECRET>

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
