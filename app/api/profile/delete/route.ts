import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function DELETE(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`profile-delete:${ip}`, 5, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  // ── Kanseller ikke-terminale Stripe-abonnement FØR kontoen slettes ──────────
  // BLOKKERENDE: feiler kanselleringen genuint, avbrytes HELE slettingen før
  // noen DB-rader røres — vi skal aldri etterlate et betalende abonnement uten
  // en konto tilknyttet (samme prinsipp som org-slettingen). "Finnes ikke /
  // allerede kansellert" (resource_missing) regnes som suksess (idempotent), så
  // en bruker aldri låses ute fra å slette pga. et abonnement i terminal tilstand.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id, personal_stripe_subscription_id')
    .eq('id', user.id)
    .maybeSingle()

  // Samme ikke-terminale sett som org-slettingen kansellerer.
  const CANCELLABLE = ['trialing', 'active', 'past_due', 'unpaid']
  const isBenignStripeError = (err: unknown) =>
    err instanceof Stripe.errors.StripeInvalidRequestError &&
    (err.code === 'resource_missing' ||
      /no such subscription|cannot be canceled|already canceled/i.test(err.message))

  try {
    if (profile?.stripe_customer_id) {
      // Primærsti: finn alle ikke-terminale abonnementer på kunden og kanseller.
      const existing = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'all',
        limit: 100,
      })
      for (const sub of existing.data.filter(s => CANCELLABLE.includes(s.status))) {
        try {
          await stripe.subscriptions.cancel(sub.id)
        } catch (err) {
          if (!isBenignStripeError(err)) throw err
        }
      }
    } else if (profile?.personal_stripe_subscription_id) {
      // Fallback: ingen customer-id, men en kjent personlig subscription-id.
      // Hent for å sjekke status; kanseller kun hvis fortsatt ikke-terminal.
      let sub: Stripe.Subscription | null = null
      try {
        sub = await stripe.subscriptions.retrieve(profile.personal_stripe_subscription_id)
      } catch (err) {
        if (!isBenignStripeError(err)) throw err // resource_missing → allerede borte
      }
      if (sub && CANCELLABLE.includes(sub.status)) {
        try {
          await stripe.subscriptions.cancel(sub.id)
        } catch (err) {
          if (!isBenignStripeError(err)) throw err
        }
      }
    }
  } catch (err) {
    // Genuin kanselleringsfeil → STOPP. Ingen DB-rader er rørt ennå.
    console.error('[profile/delete] Stripe cancellation failed for', user.id, err)
    return NextResponse.json(
      { error: 'Kunne ikke kansellere abonnementet. Ingen data ble slettet. Prøv igjen, eller kontakt support.' },
      { status: 500 },
    )
  }

  // Explicit cascade — remove user data from tables without FK cascade to auth.users
  await supabaseAdmin.from('rivalries').delete().or(`challenger_id.eq.${user.id},rival_id.eq.${user.id}`)
  await supabaseAdmin.from('league_members').delete().eq('user_id', user.id)
  await supabaseAdmin.from('season_scores').delete().eq('user_id', user.id)
  await supabaseAdmin.from('organization_members').delete().eq('user_id', user.id)

  // Quiz-historikk: attempts har INGEN FK til auth.users, så deleteUser rører den
  // ikke. Uten dette ble all spillehistorikk (attempts + attempt_answers) stående
  // for alltid med en user_id som pekte på en slettet bruker — brudd på GDPR
  // art. 17. attempt_answers.attempt_id → attempts.id, så barna slettes FØR
  // foreldrene (samme rekkefølge som admin sin quiz-reset).
  const { data: userAttempts } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('user_id', user.id)
  const attemptIds = (userAttempts ?? []).map(a => a.id)
  if (attemptIds.length > 0) {
    await supabaseAdmin.from('attempt_answers').delete().in('attempt_id', attemptIds)
    await supabaseAdmin.from('attempts').delete().eq('user_id', user.id)
  }

  // Delete user — RLS CASCADE removes the profiles row automatically
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[profile/delete] deleteUser failed:', deleteError.message)
    return NextResponse.json({ error: 'Kunne ikke slette kontoen. Prøv igjen.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
