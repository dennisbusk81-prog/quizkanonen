/**
 * Varsling til ANSATTE når en organisasjon låses (29. juli 2026).
 *
 * Bakgrunn: når en org går til `subscription_status = 'locked'` — utløpt
 * trial, kansellering, `past_due` eller `unpaid` — mistet de ansatte
 * Premium uten at noen fortalte dem det. Kun org-admin fikk beskjed, og kun
 * i `subscription.deleted`-grenen.
 *
 * BEVISST MINIMALT: kun e-post ved denne ene hendelsen. Ingen ny tabell,
 * ingen in-app-komponent. Den fulle varslingsløsningen (QK_3) vil trolig
 * overta dette senere.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmailToMany } from '@/lib/send-email-many'
import { orgAccessEndedEmail } from '@/lib/email-templates'

/**
 * Skal de ansatte varsles om denne statusovergangen?
 *
 * DUPLIKATVERNET. `stripe_events` deduper kun Stripe sine RETRIES av samme
 * event-id — det hjelper ikke her, for én reell låsing kommer typisk som
 * FLERE ulike hendelser: `subscription.updated → past_due`, deretter
 * `→ unpaid`, deretter `→ canceled`, og til slutt
 * `customer.subscription.deleted`. Alle fire utleder `nextStatus = 'locked'`
 * og ville hver sendt sin egen e-post til hele bedriften.
 *
 * Derfor sendes det kun på selve OVERGANGEN inn i låst tilstand: var orgen
 * allerede `locked` da hendelsen ankom, er de ansatte varslet, og de senere
 * hendelsene i samme sekvens er stille.
 *
 * Ren funksjon — testet uten database.
 */
export function shouldNotifyMembersOfLock(
  previousStatus: string | null | undefined,
  nextStatus: string | null | undefined,
): boolean {
  return nextStatus === 'locked' && previousStatus !== 'locked'
}

/**
 * Statuser der Stripe fortsatt driver innkreving — abonnementet er ikke
 * avsluttet, betalingen har bare ikke gått gjennom.
 */
export const DUNNING_LOCK_STATUSES: readonly string[] = ['past_due', 'unpaid']

/**
 * Skal org-ADMIN varsles om at orgen er låst på grunn av manglende betaling?
 *
 * To avgrensninger, begge bevisste:
 *
 *  1. Kun `past_due`/`unpaid`. En ekte kansellering (`canceled`,
 *     `incomplete_expired`) etterfølges alltid av
 *     `customer.subscription.deleted`, som sender den eksisterende
 *     `orgCancelledEmail`. Sendte vi noe her også, ville admin fått to
 *     e-poster for samme hendelse — og den første med feil budskap.
 *  2. Samme overgangsvakt som for de ansatte: `past_due → unpaid` er to
 *     hendelser om ett og samme problem, og skal gi én e-post.
 *
 * Ren funksjon — testet uten database.
 */
export function shouldNotifyAdminsOfDunningLock(
  previousStatus: string | null | undefined,
  stripeStatus: string | null | undefined,
): boolean {
  if (!stripeStatus || !DUNNING_LOCK_STATUSES.includes(stripeStatus)) return false
  return previousStatus !== 'locked'
}

/**
 * Sender «tilgangen gjennom bedriften er avsluttet» til alle ORDINÆRE
 * medlemmer (role !== 'admin'). Admin har allerede sin egen e-post
 * (`orgCancelledEmail`) og skal ikke få begge.
 *
 * `graceUntil` (29. juli 2026): er låsen UFRIVILLIG — utløpt trial eller avvist
 * kort — beholder de ansatte Premium i 7 dager, og da må teksten si det. Fram
 * til nå sa denne e-posten alltid «du har nå mistet den tilgangen», som ville
 * vært direkte usant i nettopp de to tilfellene. null = bevisst oppsigelse,
 * uendret tekst.
 *
 * Kaster ALDRI: kalles fra den betalingskritiske webhooken, og en feilende
 * e-post skal aldri rulle tilbake en låsing eller trigge en Stripe-retry.
 * Alt som går galt logges med `console.error` — ingenting svelges stille.
 */
/**
 * E-postadressene til medlemmene i en organisasjon.
 *
 * Trukket ut av notifyMembersOfOrgLock 29. juli 2026 fordi
 * /api/cron/expire-grace-periods trenger nøyaktig samme oppslag for
 * grace-påminnelsen — og en andre kopi av paginerings-logikken ville før eller
 * siden kommet i utakt med denne.
 *
 * `null` = oppslaget feilet, som er noe annet enn «ingen medlemmer». Kalleren
 * skal ikke tolke en feil som en tom bedrift.
 *
 * `memberCount` returneres ved siden av adressene fordi de to tilfellene er
 * ulike: en org uten ordinære medlemmer er helt normal, mens medlemmer UTEN
 * e-postadresse er en feil som skal logges.
 */
export async function getOrgMemberEmails(
  organizationId: string,
  options: { excludeAdmins?: boolean } = {},
): Promise<{ memberCount: number; emails: string[] } | null> {
  let query = supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)

  if (options.excludeAdmins) query = query.neq('role', 'admin')

  const { data: members, error: membersError } = await query

  if (membersError) {
    console.error(`[org-lock-notify] kunne ikke hente medlemmer org=${organizationId}:`, membersError.message)
    return null
  }

  const memberIds = new Set((members ?? []).map(m => m.user_id as string))
  if (memberIds.size === 0) return { memberCount: 0, emails: [] }

  // Samme mønster som app/api/org/[slug]/send-reminder: én paginert
  // listUsers framfor N getUserById-kall. En org på 50 medlemmer skal ikke
  // koste 50 rundturer inne i en webhook.
  const emails: string[] = []
  let page = 1
  while (true) {
    const { data: authData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
    if (listErr) {
      console.error(`[org-lock-notify] listUsers feilet org=${organizationId}:`, listErr.message)
      break
    }
    const users = authData?.users ?? []
    for (const u of users) {
      if (u.email && memberIds.has(u.id)) emails.push(u.email)
    }
    if (users.length < 1000) break
    page++
  }

  return { memberCount: memberIds.size, emails }
}

export async function notifyMembersOfOrgLock(
  organizationId: string,
  orgName: string | null,
  context: string,
  graceUntil: string | null = null,
): Promise<void> {
  try {
    if (!orgName) {
      console.error(`[org-lock-notify] SKIPPED — mangler orgName. org=${organizationId} (${context})`)
      return
    }

    const lookup = await getOrgMemberEmails(organizationId, { excludeAdmins: true })
    if (lookup === null) return

    const { memberCount, emails } = lookup
    if (memberCount === 0) return
    if (emails.length === 0) {
      console.error(
        `[org-lock-notify] SKIPPED — fant ingen e-postadresser for ${memberCount} medlem(mer). ` +
        `org=${organizationId} (${context})`
      )
      return
    }

    const subject = graceUntil
      ? `Tilgangen gjennom ${orgName} avsluttes snart — Quizkanonen`
      : `Tilgangen gjennom ${orgName} er avsluttet — Quizkanonen`
    const html = orgAccessEndedEmail(orgName, graceUntil)

    const { sent } = await sendEmailToMany(emails, { subject, html }, `org-lock-notify org=${organizationId}`)

    console.log(
      `[org-lock-notify] varslet ${sent}/${emails.length} ansatte org=${organizationId} (${context}) ` +
      `grace=${graceUntil ?? 'ingen'}`
    )
  } catch (err) {
    console.error(`[org-lock-notify] uventet feil org=${organizationId} (${context}):`, err)
  }
}
