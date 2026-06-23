import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { orgPurchaseEmail } from '@/lib/email-templates'

// Midlertidig admin-rute for å sende orgPurchaseEmail manuelt i ettertid når
// webhook-sendingen feilet eller ble hoppet over. Beskyttet med ADMIN_PASSWORD.
//
// Bruk:
//   curl -X POST https://www.quizkanonen.no/api/admin/org-resend-purchase \
//     -H "x-admin-password: <ADMIN_PASSWORD>" \
//     -H "Content-Type: application/json" \
//     -d '{"slug":"<org-slug>"}'

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const slug: string | undefined = body?.slug
  if (!slug) return NextResponse.json({ error: 'Mangler slug' }, { status: 400 })

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Org ikke funnet' }, { status: 404 })

  const { data: adminMember } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()

  if (!adminMember) return NextResponse.json({ error: 'Ingen admin-medlem funnet for org' }, { status: 404 })

  const { data } = await supabaseAdmin.auth.admin.getUserById(adminMember.user_id)
  const email = data.user?.email
  if (!email) return NextResponse.json({ error: 'Admin mangler e-postadresse' }, { status: 400 })

  try {
    await sendEmail({
      to: email,
      subject: `Velkommen til Quizkanonen for bedrifter — ${org.name}`,
      html: orgPurchaseEmail(org.name, org.slug),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[org-resend-purchase] sendEmail feil:', msg, err)
    return NextResponse.json({ error: `Kunne ikke sende e-post: ${msg}` }, { status: 500 })
  }

  return NextResponse.json({ sent: true, to: email, org: org.name })
}
