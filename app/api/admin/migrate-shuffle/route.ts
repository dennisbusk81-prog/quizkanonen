import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

const MIGRATION_SQL = `ALTER TABLE questions ADD COLUMN IF NOT EXISTS shuffle_options boolean NOT NULL DEFAULT false;`

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

export async function POST(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if column already exists
  const { error: checkError } = await supabaseAdmin
    .from('questions')
    .select('shuffle_options')
    .limit(1)

  if (!checkError) {
    return NextResponse.json({ ok: true, msg: 'shuffle_options-kolonnen finnes allerede.' })
  }

  // Column missing — attempt to add it via Supabase Management API SQL endpoint
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  // Extract project ref from URL: https://<ref>.supabase.co
  const projectRef = supabaseUrl.replace('https://', '').split('.')[0]

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: MIGRATION_SQL }),
    }
  )

  if (res.ok) {
    return NextResponse.json({ ok: true, msg: 'Migrering fullført — shuffle_options-kolonnen er lagt til.' })
  }

  // Fallback: return SQL for manual execution
  return NextResponse.json({
    ok: false,
    msg: 'Kunne ikke kjøre migrering automatisk. Kjør denne SQL-en manuelt i Supabase SQL Editor:',
    sql: MIGRATION_SQL,
  }, { status: 200 })
}
