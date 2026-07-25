import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

// Admin-initiert passord-reset. Ingen slik rute fantes fra før — appen har
// kun selvbetjenings-varianten på /profil (app/profil/page.tsx), som bruker
// klientens supabase.auth.resetPasswordForEmail() med brukerens egen økt.
// Denne ruten gjenbruker SAMME Supabase-mekanisme og SAMME redirect-mål, kalt
// server-side på vegne av brukeren av en admin. Selve e-posten Supabase
// sender er identisk uansett hvilken vei den ble trigget fra.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.getUserById(id)
  if (authErr || !authData?.user?.email) {
    return NextResponse.json({ error: 'Fant ingen e-post for denne brukeren' }, { status: 404 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin
  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(authData.user.email, {
    redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent('/sett-passord')}`,
  })

  if (error) {
    console.error('[admin/users send-reset] resetPasswordForEmail feilet:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  try {
    await supabaseAdmin.from('admin_actions').insert({
      action_type: 'send_password_reset',
      scope_type: 'user',
      scope_id: id,
    })
  } catch { /* ikke kritisk */ }

  return NextResponse.json({ ok: true })
}
