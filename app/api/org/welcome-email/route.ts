import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { orgWelcomeEmail } from '@/lib/email-templates'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'

// Én ekstern rundtur (Stripe/GoTrue/enkelt-e-post) — ekstern latens kan
// alene være sekunder. 30 s gir rom uten å arve plattformdefaulten på 300 s.
export const maxDuration = 30

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
    .select('id, name')
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

  // Låst org: velkomst-e-posten hører til innmeldingen, som selv er sperret i
  // /api/org/join/[token]. Sperret her også, så ingen inngang står igjen åpen.
  const lock = await requireUnlockedOrg({ id: org.id })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

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

  // Mottakeren her er den som nettopp BLE MEDLEM — i praksis en ansatt.
  // Administratoren får orgPurchaseEmail/orgTrialEmail fra Stripe-flyten i
  // stedet, så malen nevner verken bedriftspanelet eller prøveperioden.
  try {
    await sendEmail({
      to: authUser.email,
      subject: 'Velkommen til Quizkanonen!',
      html: orgWelcomeEmail(firstName, org.name),
      replyTo: 'support@quizkanonen.no',
    })
  } catch (err) {
    console.error('[welcome-email] sendEmail feil:', err)
    return NextResponse.json({ error: 'Kunne ikke sende e-post' }, { status: 500 })
  }

  // Merk som sendt.
  //
  // Bevisst IKKE en 500: e-posten ER sendt på dette tidspunktet, og et feilsvar
  // ville påstått det motsatte. Feiler stemplingen, sendes velkomsten på nytt
  // ved neste besøk — irriterende, men ufarlig. Det som IKKE er akseptabelt er
  // at det skjer uten spor, så feilen logges med søkbar markør.
  const { error: stampErr } = await supabaseAdmin
    .from('organization_members')
    .update({ welcome_email_sent: true })
    .eq('id', member.id)

  if (stampErr) {
    console.error(
      `[welcome-email] STEMPLING FEILET — velkomsten er sendt til ${authUser.email}, ` +
      `men medlem ${member.id} er ikke merket. E-posten sendes på nytt ved neste besøk:`,
      stampErr.message
    )
  }

  return NextResponse.json({ sent: true })
}
