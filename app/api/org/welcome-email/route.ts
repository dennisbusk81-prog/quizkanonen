import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { orgWelcomeEmail } from '@/lib/email-templates'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access_token: string | undefined = body?.access_token
  const orgSlug: string | undefined = body?.orgSlug

  if (!access_token || !orgSlug) {
    return NextResponse.json({ error: 'Mangler access_token eller orgSlug' }, { status: 400 })
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(access_token)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  // Hent org
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', orgSlug)
    .maybeSingle()

  if (!org) {
    return NextResponse.json({ error: 'Org ikke funnet' }, { status: 404 })
  }

  // Sjekk om e-post allerede er sendt
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('id, welcome_email_sent')
    .eq('user_id', user.id)
    .eq('organization_id', org.id)
    .maybeSingle()

  if (!member) {
    return NextResponse.json({ error: 'Ikke medlem' }, { status: 403 })
  }

  if (member.welcome_email_sent) {
    return NextResponse.json({ skipped: true, reason: 'Already sent' })
  }

  // Hent brukerens e-post og navn
  const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(user.id)
  if (!authUser?.email) {
    return NextResponse.json({ error: 'Ingen e-postadresse' }, { status: 400 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle()

  const displayName = profile?.display_name ?? authUser.email.split('@')[0]
  const firstName = displayName.split(' ')[0]

  // Send e-post
  try {
    await sendEmail({
      to: authUser.email,
      subject: `Du er med i ${org.name} på Quizkanonen`,
      html: orgWelcomeEmail(firstName, org.name, org.slug),
    })
  } catch (err) {
    console.error('[welcome-email] sendEmail feil:', err)
    return NextResponse.json({ error: 'Kunne ikke sende e-post' }, { status: 500 })
  }

  // Merk som sendt
  await supabaseAdmin
    .from('organization_members')
    .update({ welcome_email_sent: true })
    .eq('id', member.id)

  return NextResponse.json({ sent: true })
}
