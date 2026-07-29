import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { orgPurchaseEmail } from '@/lib/email-templates'
import { getOrgAdminEmails, sendToOrgAdmins } from '@/lib/org-admin-emails'

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

  // Alle admins i orgen — ikke bare én vilkårlig valgt.
  const { emails } = await getOrgAdminEmails(org.id)
  if (emails.length === 0) {
    return NextResponse.json({ error: 'Ingen admin-medlem med e-postadresse funnet for org' }, { status: 404 })
  }

  const { sent, failed } = await sendToOrgAdmins(
    emails,
    {
      subject: `Velkommen til Quizkanonen for bedrifter — ${org.name}`,
      html: orgPurchaseEmail(org.name, org.slug),
    },
    `org-resend-purchase org=${org.id}`,
  )

  if (sent === 0) {
    // Detaljene ligger allerede i [send-email-many]-loggen.
    return NextResponse.json(
      { error: `Kunne ikke sende e-post til noen av ${emails.length} admin(er)` },
      { status: 500 },
    )
  }

  return NextResponse.json({ sent, failed, to: emails, org: org.name })
}
