import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { planLeagueOwnership } from '@/lib/account-deletion'

// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

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

  // Quiz-historikk: attempts har INGEN FK til auth.users, så deleteUser rører den
  // ikke. Uten dette ble all spillehistorikk (attempts + attempt_answers) stående
  // for alltid med en user_id som pekte på en slettet bruker — brudd på GDPR
  // art. 17. Hentes før cascade-løkken slik at attempt_answers/attempts kan tas
  // med som ordinære steg i samme sekvens, i riktig rekkefølge (barn før foreldre).
  const { data: userAttempts, error: attemptsFetchErr } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('user_id', user.id)
  if (attemptsFetchErr) {
    console.error('[profile-delete] kunne ikke hente forsøk for cascade', user.id, attemptsFetchErr)
    return NextResponse.json(
      { error: 'Sletting feilet (attempts-oppslag). Prøv igjen, eller kontakt support.' },
      { status: 500 },
    )
  }
  const attemptIds = (userAttempts ?? []).map(a => a.id)

  // ── Ligaer brukeren EIER — løses FØR noe slettes ────────────────────────────
  // leagues.owner_id har ON DELETE CASCADE mot profiles.id. Uten dette steget
  // river databasen hele ligaen når profilen forsvinner, og alle de andre
  // medlemmene mister den uten forvarsel. Rekkefølgen er avgjørende: kaskaden
  // utløses av deleteUser helt til slutt, så eierskapet må være flyttet før da.
  //
  // Leses her, skrives som ordinære steg i sekvensen under, slik at de får
  // nøyaktig samme feilhåndtering som resten (én feil stopper HELE slettingen).
  const { data: ownedLeagues, error: ownedErr } = await supabaseAdmin
    .from('leagues')
    .select('id')
    .eq('owner_id', user.id)
  if (ownedErr) {
    console.error('[profile-delete] kunne ikke hente eide ligaer', user.id, ownedErr)
    return NextResponse.json(
      { error: 'Sletting feilet (liga-oppslag). Prøv igjen, eller kontakt support.' },
      { status: 500 },
    )
  }

  const leagueSteps: { table: string; run: () => PromiseLike<{ error: { message: string } | null }> }[] = []
  for (const league of ownedLeagues ?? []) {
    const { data: members, error: memberErr } = await supabaseAdmin
      .from('league_members')
      .select('user_id, joined_at')
      .eq('league_id', league.id)
    if (memberErr) {
      console.error('[profile-delete] kunne ikke hente ligamedlemmer', league.id, memberErr)
      return NextResponse.json(
        { error: 'Sletting feilet (liga-medlemmer). Prøv igjen, eller kontakt support.' },
        { status: 500 },
      )
    }

    const plan = planLeagueOwnership(league.id, members ?? [], user.id)
    if (plan.action === 'transfer') {
      leagueSteps.push({
        table: `leagues:overfør(${plan.leagueId})`,
        run: () => supabaseAdmin.from('leagues')
          .update({ owner_id: plan.newOwnerId })
          .eq('id', plan.leagueId)
          // Vakt mot kappløp: overfør kun hvis raden fortsatt er vår.
          .eq('owner_id', user.id),
      })
    } else {
      // Eneste medlem — ligaen har ingen fremtid uten brukeren. Slettes
      // eksplisitt her i stedet for å overlates til kaskaden, slik at
      // scope-rader ryddes med (season_scores for brukeren tas av steget under).
      leagueSteps.push({
        table: `excluded_members:liga(${plan.leagueId})`,
        run: () => supabaseAdmin.from('excluded_members').delete()
          .eq('scope_type', 'league').eq('scope_id', plan.leagueId),
      })
      leagueSteps.push({
        table: `leagues:slett(${plan.leagueId})`,
        run: () => supabaseAdmin.from('leagues').delete().eq('id', plan.leagueId),
      })
    }
  }

  // Explicit cascade — remove user data from tables without FK cascade to
  // auth.users. Sekvensiell for-løkke, ikke Promise.all: en skriving som
  // feiler skal stoppe HELE slettingen før deleteUser kalles, ikke bare logges
  // og ignoreres — ellers slettes kontoen likevel med data stående igjen, som
  // er nøyaktig GDPR-bruddet dette steget finnes for å forhindre. Samme
  // steg-array + feilsjekk-mønster som app/api/org/[slug]/delete/route.ts.
  const steps: { table: string; run: () => PromiseLike<{ error: { message: string } | null }> }[] = [
    // Liga-eierskap først: ligaen må ha fått ny eier (eller være slettet) før
    // brukerens egen medlemsrad forsvinner under.
    ...leagueSteps,
    // ── organizations / organization_invites: NO ACTION, ikke CASCADE ─────────
    // Databasen NEKTER å slette en profilrad disse fortsatt peker på, så uten
    // disse to stegene feiler deleteUser permanent for enhver som har opprettet
    // en organisasjon — retten til sletting blir umulig å innfri.
    //
    // Nulles, ikke slettes: created_by er ren proveniens (hvem opprettet raden),
    // ikke en rettighet. Selve admin-tilgangen ligger i organization_members.role
    // og er upåvirket. Å SLETTE radene i stedet ville tatt ned hele
    // organisasjonen — inkludert en betalende kunde — fordi én ansatt sluttet,
    // og ville brutt en aktiv invitasjonslenke som resten av bedriften bruker.
    //
    // Begge kolonnene er verifisert nullbare i prod (ikke i PostgREST sin
    // `required`-liste), så dette krever INGEN migrasjon.
    { table: 'organizations.created_by', run: () => supabaseAdmin.from('organizations')
        .update({ created_by: null }).eq('created_by', user.id) },
    { table: 'organization_invites.created_by', run: () => supabaseAdmin.from('organization_invites')
        .update({ created_by: null }).eq('created_by', user.id) },
    { table: 'rivalries', run: () => supabaseAdmin.from('rivalries').delete()
        .or(`challenger_id.eq.${user.id},rival_id.eq.${user.id}`) },
    { table: 'league_members', run: () => supabaseAdmin.from('league_members').delete()
        .eq('user_id', user.id) },
    { table: 'season_scores', run: () => supabaseAdmin.from('season_scores').delete()
        .eq('user_id', user.id) },
    { table: 'organization_members', run: () => supabaseAdmin.from('organization_members').delete()
        .eq('user_id', user.id) },
    ...(attemptIds.length > 0
      ? [
          { table: 'attempt_answers', run: () => supabaseAdmin.from('attempt_answers').delete()
              .in('attempt_id', attemptIds) },
          { table: 'attempts', run: () => supabaseAdmin.from('attempts').delete()
              .eq('user_id', user.id) },
        ]
      : []),
  ]

  for (const step of steps) {
    const { error } = await step.run()
    if (error) {
      console.error(`[profile-delete] sletting feilet på steg "${step.table}"`, user.id, error)
      return NextResponse.json(
        { error: `Sletting feilet (${step.table}). Prøv igjen, eller kontakt support.` },
        { status: 500 },
      )
    }
  }

  // Delete user — RLS CASCADE removes the profiles row automatically
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[profile/delete] deleteUser failed:', deleteError.message)
    return NextResponse.json({ error: 'Kunne ikke slette kontoen. Prøv igjen.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
