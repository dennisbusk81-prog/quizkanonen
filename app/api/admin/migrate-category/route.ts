import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

const MIGRATION_SQL = `ALTER TABLE questions ADD COLUMN IF NOT EXISTS category text;`

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if column already exists
  const { error: checkError } = await supabaseAdmin
    .from('questions')
    .select('category')
    .limit(1)

  if (!checkError) {
    return NextResponse.json({ ok: true, msg: 'category-kolonnen finnes allerede.' })
  }

  // Attempt via Supabase Management API
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
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
    return NextResponse.json({ ok: true, msg: 'Migrering fullført — category-kolonnen er lagt til på questions-tabellen.' })
  }

  return NextResponse.json({
    ok: false,
    msg: 'Kunne ikke kjøre migrering automatisk. Kjør denne SQL-en manuelt i Supabase SQL Editor:',
    sql: MIGRATION_SQL,
  }, { status: 200 })
}
