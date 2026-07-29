import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { orgRemovedEmail } from '@/lib/email-templates'

// ── ÉN kodesti for fjerning av et org-medlem ─────────────────────────────────
//
// Denne filen er trukket ut av app/api/org/members/[id]/remove/route.ts, som
// hadde alt inline i en Next.js-handler: rate-limit, Bearer-token, aktør-vakter
// OG selve fjerningen med grace-periode og e-post. Domenelogikken var dermed
// ikke kallbar fra en cron uten å kopiere den.
//
// INVARIANT: all fjerning av et org-medlem — manuell fra panelet ELLER utført av
// cronen for en planlagt dato — skal gå gjennom `removeOrgMemberById()`. Ingen
// annen kodesti skal slette en rad i organization_members på vegne av en admin.
// (Selvbetjent utmelding, app/api/org/[slug]/leave, er en ANNEN handling med
// bevisst andre regler: ingen grace-periode, umiddelbar rekalkulering.)
//
// Aktør-vaktene ligger i `resolveOrgAdminAction()` fordi de gjelder en
// forespørsel fra et menneske. Cronen har ingen aktør og skal ikke ha dem —
// den kaller `removeOrgMemberById()` direkte.

export type OrgAdminActionResult =
  | { ok: true; membership: { id: string; organization_id: string; user_id: string; role: string } }
  | { ok: false; status: 400 | 403 | 404; error: string }

/**
 * Verifiserer at `actorUserId` har lov til å utføre en admin-handling på
 * medlemsraden `membershipId`. Delt av «fjern nå» og «planlegg fjerning», slik
 * at de to aldri kan komme i utakt om hvem som får gjøre hva.
 */
export async function resolveOrgAdminAction(
  membershipId: string,
  actorUserId: string,
): Promise<OrgAdminActionResult> {
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('id, organization_id, user_id, role')
    .eq('id', membershipId)
    .maybeSingle()

  if (!membership) return { ok: false, status: 404, error: 'Medlem ikke funnet' }

  // Uendret fra den opprinnelige ruten: en admin kan ikke fjerne seg selv.
  // Det er også dette som holder «orgen har alltid minst én admin» i hevd på
  // den umiddelbare stien — se merknaden om cronen i executeScheduledRemovals.
  if (membership.user_id === actorUserId) {
    return { ok: false, status: 400, error: 'Du kan ikke fjerne deg selv' }
  }

  const { data: requesterMembership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', membership.organization_id)
    .eq('user_id', actorUserId)
    .maybeSingle()

  if (requesterMembership?.role !== 'admin') {
    return { ok: false, status: 403, error: 'Ingen tilgang' }
  }

  return { ok: true, membership }
}

export type RemovalResult =
  | { ok: true; graceUntil: string | null; orgName: string | null }
  | { ok: false; reason: 'not_found' | 'delete_failed'; error: string }

/**
 * Fjerner medlemsraden, gir grace-periode og varsler brukeren.
 *
 * Oppførselen er BEVISST identisk med den manuelle fjerningen slik den var før
 * uttrekket — inkludert at Premium ikke slås av her. Grace-stempelet settes, og
 * /api/cron/expire-grace-periods rekalkulerer mot alle kilder når det utløper.
 */
export async function removeOrgMemberById(membershipId: string): Promise<RemovalResult> {
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('id, organization_id, user_id')
    .eq('id', membershipId)
    .maybeSingle()

  if (!membership) {
    return { ok: false, reason: 'not_found', error: 'Medlem ikke funnet' }
  }

  // Premium-tilstanden til den som fjernes — MÅ leses før slettingen.
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('premium_status, personal_stripe_subscription_id')
    .eq('id', membership.user_id)
    .maybeSingle()

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', membership.organization_id)
    .maybeSingle()

  // Sjekker både error og match-count: en .eq('id', ...) som treffer 0 rader
  // (raden allerede fjernet av en samtidig forespørsel) er ikke en feil, men
  // skal heller ikke late som om NOE ble fjernet her — uten dette fortsatte
  // koden til å sende «du er fjernet»-e-post uansett resultat.
  const { data: removedRows, error: removeErr } = await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('id', membershipId)
    .select('id')

  if (removeErr || !removedRows || removedRows.length === 0) {
    console.error(
      `[org-member-removal] fjerning feilet — membership=${membershipId} org=${membership.organization_id}:`,
      removeErr?.message ?? 'matchet 0 rader',
    )
    return { ok: false, reason: 'delete_failed', error: 'Kunne ikke fjerne medlemmet. Prøv igjen.' }
  }

  // Grace period: brukere som har Premium gjennom orgen (uten eget Stripe-
  // abonnement) beholder Premium i 7 dager. premium_status holdes true; cron-
  // jobben /api/cron/expire-grace-periods slår den av når grace utløper.
  // Brukere med eget abonnement røres ikke — de beholder sin egen Premium.
  //
  // Ikke-blokkerende med vilje: medlemmet er allerede fjernet fra orgen over,
  // så en feil her er ikke grunn til å late som om selve fjerningen mislyktes —
  // men den skal ikke passere helt stille.
  //
  // Om personal_stripe_subscription_id (26. juli 2026): kolonnen ble tidligere
  // kun satt av Founders-flyten, så en betalende B2C-kunde så ut som om de ikke
  // hadde eget abonnement og fikk en unødvendig grace-periode. Webhooken lagrer
  // den nå ved checkout, og — viktigere — /api/cron/expire-grace-periods
  // rekalkulerer mot alle kilder i stedet for å slå av Premium blindt. Et
  // overflødig grace-stempel er derfor ufarlig.
  let graceUntil: string | null = null
  if (profile?.premium_status === true && !profile?.personal_stripe_subscription_id) {
    graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error: graceErr } = await supabaseAdmin.from('profiles')
      .update({ org_premium_grace_until: graceUntil })
      .eq('id', membership.user_id)
    if (graceErr) {
      console.error(`[org-member-removal] grace-period-oppdatering feilet — user=${membership.user_id}:`, graceErr.message)
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
      }).catch((err) => console.error('[org-member-removal] sendEmail feil:', err))
    }
  }

  return { ok: true, graceUntil, orgName: org?.name ?? null }
}

// ── Planlagte fjerninger ─────────────────────────────────────────────────────

// Romslig tak. Én dags planlagte fjerninger er i praksis et fåtall rader; taket
// finnes kun for å unngå en ubegrenset kjøring, og treffes det, sier loggen fra
// i stedet for at resten forsvinner stille (jf. PostgREST-avkuttingen på 1000).
const SCHEDULED_BATCH_LIMIT = 200

export type ScheduledRemovalRun = {
  due: number
  removed: number
  skippedLastAdmin: number
  failed: number
  truncated: boolean
  details: { membershipId: string; outcome: string }[]
}

/**
 * Utfører fjerninger som har forfalt (`scheduled_removal_at <= nå`).
 *
 * Kaller `removeOrgMemberById()` — SAMME kodesti som «Fjern nå» i panelet — så
 * grace-periode og e-post er identisk med en manuell fjerning. Ingen parallell
 * fjerningsvei.
 */
export async function executeScheduledRemovals(now: Date = new Date()): Promise<ScheduledRemovalRun> {
  const run: ScheduledRemovalRun = {
    due: 0, removed: 0, skippedLastAdmin: 0, failed: 0, truncated: false, details: [],
  }

  // AVBRUTT PLAN = kolonnen settes til NULL, og NULL blir aldri plukket opp her:
  // `NULL <= '<dato>'` er NULL i SQL, ikke true, så raden faller ut av `.lte()`
  // alene. `.not(... is null)` er derfor EKSPLISITT, ikke en uavhengig vakt — å
  // fjerne den endrer ingenting i praksis (verifisert med mutasjonstest). Det som
  // faktisk beskytter en avbrutt plan, er at avbrytelsen skriver NULL (DELETE i
  // schedule-removal-ruten) og at dette predikatet aldri regner NULL som forfalt.
  const { data: dueRows, error } = await supabaseAdmin
    .from('organization_members')
    .select('id, organization_id, user_id, role, scheduled_removal_at')
    .not('scheduled_removal_at', 'is', null)
    .lte('scheduled_removal_at', now.toISOString())
    .order('scheduled_removal_at', { ascending: true })
    .limit(SCHEDULED_BATCH_LIMIT)

  if (error) {
    console.error('[scheduled-removals] kunne ikke hente forfalte rader:', error.message)
    throw new Error(`Kunne ikke hente forfalte fjerninger: ${error.message}`)
  }

  const rows = (dueRows ?? []) as {
    id: string; organization_id: string; user_id: string; role: string; scheduled_removal_at: string
  }[]

  run.due = rows.length
  run.truncated = rows.length === SCHEDULED_BATCH_LIMIT
  if (run.truncated) {
    console.warn(`[scheduled-removals] traff taket på ${SCHEDULED_BATCH_LIMIT} — resten tas ved neste kjøring`)
  }

  for (const row of rows) {
    // ── Siste-admin-vakt ────────────────────────────────────────────────────
    // På den umiddelbare stien er dette umulig: en admin kan ikke fjerne seg
    // selv, så noen må alltid bli igjen. Over tid kan det likevel oppstå — en
    // admin planlegges fjernet, og den ANDRE admin-en melder seg ut selv
    // (/api/org/[slug]/leave) før datoen. Da ville cronen ha etterlatt en org
    // uten administrator: ingen kunne invitere, fakturere eller avslutte den.
    //
    // Planen beholdes bevisst i stedet for å nullstilles: den utføres av seg
    // selv så snart en ny admin er utpekt, og loggen gjentar seg daglig til
    // noen rydder opp — synlig, ikke stille.
    if (row.role === 'admin') {
      const { count: adminCount, error: countErr } = await supabaseAdmin
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', row.organization_id)
        .eq('role', 'admin')

      if (countErr || adminCount == null || adminCount <= 1) {
        run.skippedLastAdmin++
        run.details.push({ membershipId: row.id, outcome: 'skipped_last_admin' })
        console.error(
          `[scheduled-removals] HOPPET OVER — ville etterlatt org=${row.organization_id} uten admin. ` +
          `membership=${row.id} user=${row.user_id} ` +
          `${countErr ? `(telling feilet: ${countErr.message})` : `(administratorer: ${adminCount})`}. ` +
          `Planen står, og utføres når en ny admin er utpekt.`,
        )
        continue
      }
    }

    const result = await removeOrgMemberById(row.id)

    if (!result.ok) {
      run.failed++
      run.details.push({ membershipId: row.id, outcome: result.reason })
      // not_found = raden er allerede borte (medlemmet meldte seg ut selv, eller
      // en admin fjernet dem manuelt før datoen). Ikke en feil å rette, men den
      // skal ikke forsvinne fra loggen.
      console.error(
        `[scheduled-removals] fjerning ga «${result.reason}» — membership=${row.id} ` +
        `user=${row.user_id} org=${row.organization_id}: ${result.error}`,
      )
      continue
    }

    run.removed++
    run.details.push({ membershipId: row.id, outcome: 'removed' })
    console.log(
      `[scheduled-removals] fjernet user=${row.user_id} fra org=${row.organization_id} ` +
      `(planlagt ${row.scheduled_removal_at}), grace=${result.graceUntil ?? 'ingen'}`,
    )

    // Bokfør på orgen. user_id er null: handlingen er utført av systemet på
    // vegne av en beslutning som allerede er logget som
    // org_member_removal_scheduled.
    try {
      const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
        action_type: 'org_member_removal_executed',
        scope_type: 'organization',
        scope_id: row.organization_id,
      })
      if (logErr) console.error('[scheduled-removals] admin_actions-logging feilet', row.organization_id, logErr.message)
    } catch (err) {
      console.error('[scheduled-removals] admin_actions-logging kastet', row.organization_id, err)
    }
  }

  return run
}
