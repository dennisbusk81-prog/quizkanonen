import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  CLEANUP_MIN_AGE_MS,
  decideOrgCleanup,
  describeOrg,
  type CleanupCandidate,
  type StripeLookup,
  type StripeSubLike,
} from '@/lib/org-cleanup'

// Rydder opp foreldreløse organisasjoner: org-raden opprettes FØR Stripe-betaling,
// så et avbrutt checkout etterlater en org uten stripe_subscription_id.
//
// Den lokale kolonnen alene er IKKE nok til å avgjøre om org-en er forlatt:
// `stripe_subscription_id` skrives kun av webhooken (checkout.session.completed),
// i samme UPDATE som `stripe_customer_id`. Feiler eller forsinkes den webhooken,
// ser en betalende bedrift nøyaktig ut som et forlatt forsøk. Hver kandidat
// kryssjekkes derfor mot Stripe før noe slettes, og vi feiler LUKKET: kan
// abonnementstilstanden ikke bekreftes, beholdes org-en.
//
// Beslutningslogikken (rekkefølge, hvilke statuser som beskytter, hva som feiler
// lukket) ligger i lib/org-cleanup.ts og er testdekket der.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Finner alle Stripe-abonnementer som hører til org-en.
 *
 * To veier, fordi de to opprettelsesstiene etterlater ulike spor:
 *  - Har vi `stripe_customer_id` lokalt, er kunden fasit.
 *  - Har vi den ikke (nettopp det tilfellet som er farlig), søker vi på
 *    `metadata.organization_id`. org-founders-activate setter den på både kunde
 *    og abonnement; org-checkout setter den nå via `subscription_data.metadata`,
 *    slik at også den betalte stien er gjenfinnbar uten lokal kobling.
 */
async function lookupOrgSubscriptions(
  stripe: Stripe,
  org: { id: string; stripe_customer_id: string | null },
): Promise<StripeLookup> {
  try {
    if (org.stripe_customer_id) {
      const res = await stripe.subscriptions.list({
        customer: org.stripe_customer_id,
        status: 'all',
        limit: 100,
      })
      return { ok: true, subscriptions: res.data as unknown as StripeSubLike[] }
    }

    // Org-id-en går inn i en Stripe-søkestreng. Den kommer fra vår egen database
    // og er alltid en UUID, men vi bekrefter formen i stedet for å anta den.
    if (!UUID_RE.test(org.id)) {
      return { ok: false, error: `org-id har uventet form: ${org.id}` }
    }

    const res = await stripe.subscriptions.search({
      query: `metadata['organization_id']:'${org.id}'`,
      limit: 100,
    })
    return { ok: true, subscriptions: res.data as unknown as StripeSubLike[] }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Stripe instansieres inne i try (samme mønster som stripe/subscription-ruten):
  // en manglende eller ugyldig STRIPE_SECRET_KEY skal gi en logget feilrespons,
  // ikke en rå 500 — og aller minst skal den føre til at vi sletter orger uten å
  // ha kunnet spørre Stripe.
  let stripe: Stripe
  try {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  } catch (err) {
    console.error('[cron/cleanup-orgs] kunne ikke initialisere Stripe — ingen orger vurdert:', err)
    return NextResponse.json({ error: 'Stripe utilgjengelig' }, { status: 500 })
  }

  const cutoff = new Date(Date.now() - CLEANUP_MIN_AGE_MS).toISOString()

  const { data: orphans, error: selectError } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, created_at, stripe_customer_id, subscription_status')
    .is('stripe_subscription_id', null)
    .lt('created_at', cutoff)

  if (selectError) {
    console.error('[cron/cleanup-orgs] select error:', selectError.message)
    return NextResponse.json({ error: selectError.message }, { status: 500 })
  }

  if (!orphans || orphans.length === 0) {
    return NextResponse.json({ deleted: 0, skipped: 0 })
  }

  const approved: CleanupCandidate[] = []
  const skipped: { org: string; reason: string; detail: string }[] = []

  for (const row of orphans) {
    const { count: memberCount, error: countErr } = await supabaseAdmin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', row.id)

    // Uten et bekreftet medlemstall vet vi ikke om org-en er i bruk. Feil lukket:
    // hopp over denne runden i stedet for å slette på et ukjent grunnlag.
    if (countErr || memberCount == null) {
      console.error(
        `[cron/cleanup-orgs] HOPPET OVER — kunne ikke telle medlemmer for org=${row.id}:`,
        countErr?.message ?? 'count var null',
      )
      skipped.push({ org: row.id, reason: 'member_count_failed', detail: countErr?.message ?? 'count var null' })
      continue
    }

    const candidate: CleanupCandidate = {
      id: row.id,
      name: row.name ?? null,
      slug: row.slug ?? null,
      created_at: row.created_at ?? null,
      stripe_customer_id: row.stripe_customer_id ?? null,
      subscription_status: row.subscription_status ?? null,
      memberCount,
    }

    // Stripe-oppslaget hoppes over når den billigere vakten allerede skjermer
    // org-en — da er utfallet gitt, og et unødvendig API-kall er unødvendig.
    const lookup: StripeLookup = candidate.memberCount > 1
      ? null
      : await lookupOrgSubscriptions(stripe, candidate)

    const verdict = decideOrgCleanup(candidate, lookup)

    if (verdict.action === 'skip') {
      skipped.push({ org: candidate.id, reason: verdict.reason, detail: verdict.detail })

      // Et levende abonnement uten lokal kobling er ikke en normaltilstand — det
      // betyr at en betaling er registrert hos Stripe uten at webhooken landet.
      // Den må repareres manuelt, og skal derfor logges som feil, ikke som info.
      if (verdict.reason === 'live_subscription') {
        console.error(
          `[cron/cleanup-orgs] IKKE SLETTET — org har levende abonnement hos Stripe, men mangler ` +
          `stripe_subscription_id lokalt. Må repareres manuelt, ikke slettes. ` +
          `${describeOrg(candidate)} abonnement=${verdict.detail}`,
        )
      } else if (verdict.reason === 'stripe_unverified') {
        console.error(
          `[cron/cleanup-orgs] HOPPET OVER — kunne ikke bekrefte Stripe-tilstand. ` +
          `${describeOrg(candidate)} årsak=${verdict.detail}`,
        )
      } else {
        console.log(`[cron/cleanup-orgs] hoppet over (${verdict.reason}) — ${describeOrg(candidate)}`)
      }
      continue
    }

    console.log(`[cron/cleanup-orgs] sletter forlatt org — ${describeOrg(candidate)}`)
    approved.push(candidate)
  }

  if (approved.length === 0) {
    return NextResponse.json({ deleted: 0, skipped: skipped.length, skippedDetails: skipped })
  }

  const orgIds = approved.map(o => o.id)

  // Slett barn-rader først (i tilfelle FK uten cascade), deretter selve orgene.
  // Stopp hvis et steg feiler, så vi ikke sletter en org hvis barn-rader henger igjen.
  const { error: invitesError } = await supabaseAdmin
    .from('organization_invites').delete().in('organization_id', orgIds)
  if (invitesError) {
    console.error('[cron/cleanup-orgs] invites delete error:', invitesError.message)
    return NextResponse.json({ error: invitesError.message }, { status: 500 })
  }

  const { error: membersError } = await supabaseAdmin
    .from('organization_members').delete().in('organization_id', orgIds)
  if (membersError) {
    console.error('[cron/cleanup-orgs] members delete error:', membersError.message)
    return NextResponse.json({ error: membersError.message }, { status: 500 })
  }

  const { error: deleteError } = await supabaseAdmin
    .from('organizations').delete().in('id', orgIds)
  if (deleteError) {
    console.error('[cron/cleanup-orgs] orgs delete error:', deleteError.message)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({
    deleted: orgIds.length,
    skipped: skipped.length,
    skippedDetails: skipped,
  })
}
