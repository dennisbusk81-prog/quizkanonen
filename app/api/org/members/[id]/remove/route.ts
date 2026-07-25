import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { orgRemovedEmail } from '@/lib/email-templates'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-member-remove:${ip}`, 20, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id: membershipId } = await params

  // Get membership row
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, user_id, role')
    .eq('id', membershipId)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Medlem ikke funnet' }, { status: 404 })

  // Must not remove yourself
  if (membership.user_id === user.id) {
    return NextResponse.json({ error: 'Du kan ikke fjerne deg selv' }, { status: 400 })
  }

  // Must be admin of this org
  const { data: requesterMembership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', membership.organization_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (requesterMembership?.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  // Premium-tilstand til den fjernede brukeren
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, personal_stripe_subscription_id')
    .eq('id', membership.user_id)
    .maybeSingle()

  // Fetch org name for email
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', membership.organization_id)
    .maybeSingle()

  // Remove from org. Sjekker både error og match-count: en .eq('id', ...) som
  // treffer 0 rader (raden allerede fjernet av en samtidig forespørsel) er ikke
  // en feil, men skal heller ikke late som om NOE ble fjernet her — uten dette
  // fortsatte koden til å sende «du er fjernet»-e-post uansett resultat.
  const { data: removedRows, error: removeErr } = await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('id', membershipId)
    .select('id')

  if (removeErr || !removedRows || removedRows.length === 0) {
    console.error(
      `[remove-member] fjerning feilet — membership=${membershipId} org=${membership.organization_id}:`,
      removeErr?.message ?? 'matchet 0 rader'
    )
    return NextResponse.json({ error: 'Kunne ikke fjerne medlemmet. Prøv igjen.' }, { status: 500 })
  }

  // Grace period: brukere som har Premium gjennom orgen (uten eget Stripe-
  // abonnement) beholder Premium i 7 dager. premium_status holdes true; cron-
  // jobben /api/cron/expire-grace-periods slår den av når grace utløper.
  // Brukere med eget abonnement røres ikke — de beholder sin egen Premium.
  //
  // Ikke-blokkerende med vilje: medlemmet er allerede fjernet fra orgen over,
  // så en feil her er ikke grunn til å late som om selve fjerningen mislyktes —
  // men den skal ikke lenger passere helt stille.
  let graceUntil: string | null = null
  if (profile?.premium_status === true && !profile?.personal_stripe_subscription_id) {
    graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error: graceErr } = await supabaseAdmin.from('profiles')
      .update({ org_premium_grace_until: graceUntil })
      .eq('id', membership.user_id)
    if (graceErr) {
      console.error(`[remove-member] grace-period-oppdatering feilet — user=${membership.user_id}:`, graceErr.message)
    }
  }

  // Send removal email (fire-and-forget)
  if (org?.name) {
    const { data: { user: removedUser } } = await supabaseAdmin.auth.admin.getUserById(membership.user_id)
    if (removedUser?.email) {
      sendEmail({
        to: removedUser.email,
        subject: `Du er fjernet fra ${org.name} på Quizkanonen`,
        html: orgRemovedEmail(org.name, graceUntil),
      }).catch((err) => console.error('[remove-member] sendEmail feil:', err))
    }
  }

  return NextResponse.json({ ok: true })
}
