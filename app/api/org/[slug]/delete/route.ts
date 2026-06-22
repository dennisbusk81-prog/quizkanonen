import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { orgRemovedEmail } from '@/lib/email-templates'

type Params = { params: Promise<{ slug: string }> }

// POST /api/org/[slug]/delete — org-admin avslutter og sletter egen organisasjon.
//
// ABSOLUTT PRINSIPP: Sletting av en org skal ALDRI røre ansattes personlige
// kontoer eller individuell spillhistorikk. Kun org-spesifikke rader fjernes —
// profiles, attempts, attempt_answers, played_log, globale/liga-season_scores,
// leagues og league_members beholdes. Ansatte fortsetter som vanlige B2C-brukere.
export async function POST(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-delete:${ip}`, 5, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // orgId er UUID her, ikke en slug — kun param-navn er beholdt for routing-konsistens
  const { slug: orgId } = await params

  // Verifiser at brukeren er org-admin
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Kun admins kan avslutte bedriftskontoen.' }, { status: 403 })
  }

  // Hent org for Stripe-kunde
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, stripe_customer_id')
    .eq('id', orgId)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Organisasjon ikke funnet' }, { status: 404 })

  // ── 1. Kanseller aktivt Stripe-abonnement (samme mønster som org-checkout) ──
  // Alle ikke-terminale abonnementer på kunden kanselleres. Feiler dette,
  // avbryt HELE operasjonen før noen DB-rader røres.
  if (org.stripe_customer_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
      const existing = await stripe.subscriptions.list({
        customer: org.stripe_customer_id,
        status: 'all',
        limit: 100,
      })
      const cancellable = existing.data.filter(s =>
        ['past_due', 'unpaid', 'trialing', 'active'].includes(s.status)
      )
      for (const sub of cancellable) {
        await stripe.subscriptions.cancel(sub.id)
      }
    } catch (stripeErr) {
      console.error('[org-delete] Stripe-kansellering feilet, avbryter sletting', orgId, stripeErr)
      return NextResponse.json({ error: 'Kunne ikke kansellere abonnementet. Ingen data ble slettet.' }, { status: 500 })
    }
  }

  // ── 1b. Grace period for medlemmer med org-Premium ─────────────────────────
  // Hent alle medlemmer + premium-tilstand FØR medlemskapene slettes. De som har
  // Premium gjennom orgen (uten eget Stripe-abonnement) får 7 dager grace:
  // premium_status holdes true, og org_premium_grace_until settes. Cron-jobben
  // slår av Premium når grace utløper. Brukere med eget abonnement røres ikke.
  // Grace/e-post skal aldri blokkere selve slettingen.
  try {
    const { data: members } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)

    const memberIds = (members ?? []).map(m => m.user_id)
    if (memberIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, premium_status, personal_stripe_subscription_id')
        .in('id', memberIds)

      const eligible = (profiles ?? []).filter(
        p => p.premium_status === true && !p.personal_stripe_subscription_id
      )

      if (eligible.length > 0) {
        const graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        await supabaseAdmin
          .from('profiles')
          .update({ org_premium_grace_until: graceUntil })
          .in('id', eligible.map(p => p.id))

        // Send grace-e-post til hver berørt bruker (fire-and-forget)
        for (const p of eligible) {
          const { data: { user: u } } = await supabaseAdmin.auth.admin.getUserById(p.id)
          if (u?.email) {
            sendEmail({
              to: u.email,
              subject: `Du er fjernet fra ${org.name} på Quizkanonen`,
              html: orgRemovedEmail(org.name, graceUntil),
            }).catch(err => console.error('[org-delete] sendEmail feil:', err))
          }
        }
      }
    }
  } catch (graceErr) {
    console.error('[org-delete] grace-period-steg feilet (fortsetter sletting)', orgId, graceErr)
  }

  // ── 2. Slett org-spesifikke rader i riktig rekkefølge (FK-hensyn) ──────────
  const steps: { table: string; run: () => PromiseLike<{ error: { message: string } | null }> }[] = [
    {
      table: 'excluded_members',
      run: () => supabaseAdmin.from('excluded_members').delete()
        .eq('scope_type', 'organization').eq('scope_id', orgId),
    },
    {
      table: 'admin_actions',
      run: () => supabaseAdmin.from('admin_actions').delete()
        .eq('scope_type', 'organization').eq('scope_id', orgId),
    },
    {
      table: 'season_scores',
      run: () => supabaseAdmin.from('season_scores').delete()
        .eq('scope_type', 'organization').eq('scope_id', orgId),
    },
    {
      table: 'organization_invites',
      run: () => supabaseAdmin.from('organization_invites').delete()
        .eq('organization_id', orgId),
    },
    {
      table: 'organization_members',
      run: () => supabaseAdmin.from('organization_members').delete()
        .eq('organization_id', orgId),
    },
    {
      table: 'organizations',
      run: () => supabaseAdmin.from('organizations').delete()
        .eq('id', orgId),
    },
  ]

  for (const step of steps) {
    const { error } = await step.run()
    if (error) {
      console.error(`[org-delete] sletting feilet på steg "${step.table}"`, orgId, error)
      return NextResponse.json(
        { error: `Sletting feilet (${step.table}). Kontakt support hvis problemet vedvarer.` },
        { status: 500 },
      )
    }
    console.log(`[org-delete] slettet ${step.table} for org ${orgId}`)
  }

  console.log(`[org-delete] organisasjon "${org.name}" (${orgId}) fullstendig avsluttet av ${user.id}`)
  return NextResponse.json({ ok: true })
}
