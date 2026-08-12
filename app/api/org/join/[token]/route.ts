import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { checkMemberCapacity } from '@/lib/org-plan'
import { reportMoneyPathFailure } from '@/lib/money-path-alert'
import {
  requireUnlockedOrg,
  ORG_LOCKED_CODE,
  ORG_LOCKED_JOIN_ERROR,
} from '@/lib/org-lock-guard'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: inviteToken } = await params

  const { data: invite } = await supabaseAdmin
    .from('organization_invites')
    .select('id, organization_id, is_active, expires_at, max_uses, use_count')
    .eq('token', inviteToken)
    .maybeSingle()

  if (!invite || !invite.is_active) {
    return NextResponse.json({ valid: false, error: 'Ugyldig invitasjonslenke' }, { status: 404 })
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, error: 'Invitasjonslenken har utløpt' }, { status: 410 })
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return NextResponse.json({ valid: false, error: 'Invitasjonslenken er full' }, { status: 410 })
  }

  // Låst org: si fra HER i stedet for å la den ansatte gå gjennom hele flyten
  // og bli avvist først på siste klikk.
  const lock = await requireUnlockedOrg({ id: invite.organization_id })
  if (!lock.ok) {
    const locked = lock.body.code === ORG_LOCKED_CODE
    return NextResponse.json(
      { valid: false, error: locked ? ORG_LOCKED_JOIN_ERROR : lock.body.error },
      { status: lock.status },
    )
  }

  return NextResponse.json({ valid: true, orgName: lock.org.name, orgSlug: lock.org.slug })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!(await rateLimitShared(`org-join:${ip}`, 10, 60_000)).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { token: inviteToken } = await params

  // Validate invite
  const { data: invite } = await supabaseAdmin
    .from('organization_invites')
    .select('id, organization_id, is_active, expires_at, max_uses, use_count')
    .eq('token', inviteToken)
    .maybeSingle()

  if (!invite || !invite.is_active) {
    return NextResponse.json({ error: 'Ugyldig invitasjonslenke' }, { status: 404 })
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invitasjonslenken har utløpt' }, { status: 410 })
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return NextResponse.json({ error: 'Invitasjonslenken er full' }, { status: 410 })
  }

  // Get org slug for redirect
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('slug, name, plan')
    .eq('id', invite.organization_id)
    .maybeSingle()

  // Guard: org deleted between invite creation and join attempt
  if (!org?.slug) {
    return NextResponse.json({ error: 'Organisasjonen finnes ikke lenger' }, { status: 404 })
  }

  // One org per user — but re-clicking an invite you already used for THIS
  // org should not dead-end. Only block when the user belongs to a
  // DIFFERENT org than the one this invite points to.
  const { data: existing } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (existing) {
    if (existing.organization_id === invite.organization_id) {
      return NextResponse.json({ slug: org.slug })
    }
    // Send med navn og slug på orgen brukeren ALLEREDE er i. Uten dette var
    // 409-en en ren blindvei: «du er allerede medlem av en organisasjon», uten
    // å si hvilken og uten noen vei videre. Med slugen kan invitasjonssiden
    // lenke til /org/[slug], der «Forlat organisasjon» nå ligger.
    const { data: currentOrg } = await supabaseAdmin
      .from('organizations')
      .select('name, slug')
      .eq('id', existing.organization_id)
      .maybeSingle()

    return NextResponse.json({
      error: 'Du er allerede medlem av en organisasjon.',
      code: 'already_in_org',
      currentOrgName: currentOrg?.name ?? null,
      currentOrgSlug: currentOrg?.slug ?? null,
    }, { status: 409 })
  }

  // ── Låst org ────────────────────────────────────────────────────────────────
  // VIKTIGST av lås-sjekkene: innmeldingen lenger ned setter `premium_status`
  // på den som blir med. Uten denne vakten delte en bedrift som hadde sluttet å
  // betale fortsatt ut Premium til nye ansatte — direkte inntektstap, og helt
  // usynlig fordi lås-skjermen kun er en UI-sperre på org-sidene.
  //
  // Plassert ETTER «allerede medlem»-grenen over, av samme grunn som
  // medlemsgrensen: en som re-klikker sin egen invitasjon skal ikke havne i en
  // blindvei for noe de allerede er innenfor.
  const lock = await requireUnlockedOrg({ id: invite.organization_id })
  if (!lock.ok) {
    const locked = lock.body.code === ORG_LOCKED_CODE
    if (locked) {
      console.warn(`[org-join] avvist — org=${invite.organization_id} er låst`)
    }
    return NextResponse.json(
      locked
        ? { error: ORG_LOCKED_JOIN_ERROR, code: ORG_LOCKED_CODE }
        : lock.body,
      { status: lock.status },
    )
  }

  // ── Medlemsgrense for planen ────────────────────────────────────────────────
  // Sjekkes ETTER «allerede medlem»-grenen over, slik at en som re-klikker sin
  // egen invitasjon aldri blokkeres av en grense de allerede er innenfor.
  //
  // Grandfathering: en org som alt ligger over grensen mister ingen — den kan
  // bare ikke ta inn flere. Ingen kodesti fjerner noen på grunn av en grense.
  const { count: memberCount, error: memberCountErr } = await supabaseAdmin
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', invite.organization_id)

  if (memberCountErr || memberCount == null) {
    // Feiler lukket: uten et bekreftet medlemstall kan vi ikke vite om det er
    // plass, og å slippe inn en for mange gir bedriften en plan de ikke betaler
    // for. En kort forsinkelse for den som blir med er det mindre onde.
    console.error(
      `[org-join] kunne ikke telle medlemmer — org=${invite.organization_id}:`,
      memberCountErr?.message ?? 'count var null',
    )
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte ledig plass akkurat nå. Prøv igjen om litt.' },
      { status: 503 },
    )
  }

  const capacity = checkMemberCapacity(org.plan, memberCount)
  if (!capacity.ok) {
    // Den som prøver å bli med kan ikke gjøre noe med dette selv — meldingen
    // peker derfor på administratoren, ikke på en handling de ikke har.
    console.warn(
      `[org-join] avvist på medlemsgrense — org=${invite.organization_id} ` +
      `plan=${org.plan} medlemmer=${memberCount} grense=${capacity.limit}`,
    )
    return NextResponse.json({
      error: `${org.name ?? 'Bedriften'} har nådd medlemsgrensen i abonnementet sitt. Ta kontakt med administratoren, så kan de oppgradere planen eller frigjøre en plass.`,
      code: 'member_limit_reached',
    }, { status: 403 })
  }

  // Premium-overgang: LES det personlige abonnementet nå, men kanseller det
  // ikke ennå.
  //
  // REKKEFØLGEN ER SIKKERHETSKRITISK. Fram til 26. juli kansellerte ruten det
  // betalte abonnementet her — altså FØR medlems-innsettingen og premium-
  // oppdateringen under, som begge var ubevoktet. Feilet en av dem, satt
  // brukeren igjen uten abonnement OG uten organisasjon, med en 200-respons som
  // sa at innmeldingen gikk bra. Kansellering er ugjenkallelig, så den skjer nå
  // sist: først når begge skrivingene er BEKREFTET.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, premium_source, stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  const personalCustomerId =
    profile?.premium_status === true && profile?.premium_source === 'personal'
      ? profile.stripe_customer_id
      : null

  // Atomically increment use_count only if it has not changed since we read it
  // (and is still under max_uses). If another concurrent request already used
  // the last slot, this update matches zero rows and we return 409.
  let countQuery = supabaseAdmin
    .from('organization_invites')
    .update({ use_count: invite.use_count + 1 })
    .eq('id', invite.id)
    .eq('use_count', invite.use_count) // CAS — reject if count changed
  if (invite.max_uses !== null) {
    countQuery = countQuery.lt('use_count', invite.max_uses)
  }
  const { data: updatedInvite } = await countQuery.select('id').maybeSingle()

  if (!updatedInvite) {
    return NextResponse.json({ error: 'Invitasjonslenken er full' }, { status: 409 })
  }

  // Frigir invitasjonsplassen igjen hvis noe under feiler. CAS-vakt: rører kun
  // raden dersom ingen andre har endret use_count i mellomtiden. Uten dette
  // ville hvert mislykket forsøk brent en plass permanent, og en invitasjon med
  // max_uses kunne blitt «full» uten at én eneste ansatt kom inn.
  const releaseInviteSeat = async () => {
    const { error } = await supabaseAdmin
      .from('organization_invites')
      .update({ use_count: invite.use_count })
      .eq('id', invite.id)
      .eq('use_count', invite.use_count + 1)
    if (error) {
      console.error(`[org-join] kunne ikke frigi invitasjonsplass invite=${invite.id}:`, error.message)
    }
  }

  // Add to org only after the atomic increment succeeded
  const { error: memberErr } = await supabaseAdmin.from('organization_members').insert({
    organization_id: invite.organization_id,
    user_id: user.id,
    role: 'member',
    invite_token_id: invite.id,
  })

  if (memberErr) {
    // 23505 = unique (user_id, organization_id). En samtidig forespørsel rakk
    // først; brukeren ER medlem. Ikke en feil for brukeren — men plassen skal
    // ikke telles to ganger, og abonnementet er allerede håndtert av det andre
    // kallet, så vi kansellerer ingenting her.
    if (memberErr.code === '23505') {
      await releaseInviteSeat()
      return NextResponse.json({ slug: org.slug })
    }
    console.error(
      `[org-join] medlems-insert feilet — user=${user.id} org=${invite.organization_id} invite=${invite.id}:`,
      memberErr.message
    )
    await releaseInviteSeat()
    return NextResponse.json({ error: 'Kunne ikke fullføre innmeldingen. Prøv igjen.' }, { status: 500 })
  }

  // Activate premium via org
  const { error: premiumErr } = await supabaseAdmin.from('profiles').update({
    premium_status: true,
    premium_source: 'org',
  }).eq('id', user.id)

  if (premiumErr) {
    // Rull tilbake medlemskapet slik at et nytt forsøk starter fra en ren
    // tilstand. Uten dette ville retry-en truffet «allerede medlem»-grenen over
    // og returnert suksess, mens brukeren satt uten premium for alltid.
    console.error(
      `[org-join] premium-update feilet — user=${user.id} org=${invite.organization_id}, ruller tilbake medlemskap:`,
      premiumErr.message
    )
    const { error: undoErr } = await supabaseAdmin
      .from('organization_members')
      .delete()
      .eq('user_id', user.id)
      .eq('organization_id', invite.organization_id)
    if (undoErr) {
      console.error(
        `[org-join] KRITISK: kunne ikke rulle tilbake medlemskap — user=${user.id} org=${invite.organization_id}:`,
        undoErr.message
      )
    }
    await releaseInviteSeat()
    return NextResponse.json({ error: 'Kunne ikke fullføre innmeldingen. Prøv igjen.' }, { status: 500 })
  }

  // ── Først NÅ er det trygt å kansellere det personlige abonnementet ─────────
  // Begge skrivingene over er bekreftet. Feiler kanselleringen her, står
  // brukeren igjen med org-premium OG et aktivt personlig abonnement. Det er et
  // bevisst valgt, ufarlig overlapp: brukeren mister ingen tilgang, og det kan
  // ryddes manuelt i Stripe. Den gamle rekkefølgen kunne til sammenligning
  // etterlate brukeren uten noen av delene.
  if (personalCustomerId) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
      const subs = await stripe.subscriptions.list({
        customer: personalCustomerId,
        status: 'active',
        limit: 1,
      })
      if (subs.data.length > 0) {
        const sub = subs.data[0]
        const { error: subIdErr } = await supabaseAdmin.from('profiles').update({
          personal_stripe_subscription_id: sub.id,
        }).eq('id', user.id)
        if (subIdErr) {
          // Kun en breadcrumb for senere reaktivering — ikke verdt å avbryte
          // innmeldingen for, men må kunne finnes igjen i loggen.
          console.error(
            `[org-join] kunne ikke lagre personal_stripe_subscription_id — user=${user.id} sub=${sub.id}:`,
            subIdErr.message
          )
        }
        await stripe.subscriptions.cancel(sub.id)
      }
    } catch (err) {
      // PENGER: brukeren betaler fortsatt kr 49/mnd for et personlig abonnement
      // som nå er overflødig. Må kanselleres manuelt i Stripe.
      console.error(
        `[org-join] KRITISK: kunne ikke kansellere personlig abonnement — user=${user.id} ` +
        `customer=${personalCustomerId} org=${invite.organization_id}. ` +
        `Brukeren har org-premium og BETALER FORTSATT personlig:`,
        err
      )
      // Ruten svarer 200 og brukeren er inne i org-en — de merker ingenting og
      // sier derfor aldri fra. Trekket løper videre hver måned til noen rydder.
      reportMoneyPathFailure({
        operation: 'org/join:cancel-personal-subscription',
        consequence:
          'Brukeren betaler kr 49/mnd for et personlig abonnement de nå får dekket ' +
          'gjennom org-en. Løper til det kanselleres manuelt i Stripe.',
        err,
        context: {
          personalCustomerId,
          userId: user.id,
          orgId: invite.organization_id,
        },
      })
    }
  }

  return NextResponse.json({ slug: org.slug })
}
