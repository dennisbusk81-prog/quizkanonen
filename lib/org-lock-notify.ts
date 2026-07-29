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
import { sendEmail } from '@/lib/email'
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
 * Sender «tilgangen gjennom bedriften er avsluttet» til alle ORDINÆRE
 * medlemmer (role !== 'admin'). Admin har allerede sin egen e-post
 * (`orgCancelledEmail`) og skal ikke få begge.
 *
 * Kaster ALDRI: kalles fra den betalingskritiske webhooken, og en feilende
 * e-post skal aldri rulle tilbake en låsing eller trigge en Stripe-retry.
 * Alt som går galt logges med `console.error` — ingenting svelges stille.
 */
export async function notifyMembersOfOrgLock(
  organizationId: string,
  orgName: string | null,
  context: string,
): Promise<void> {
  try {
    if (!orgName) {
      console.error(`[org-lock-notify] SKIPPED — mangler orgName. org=${organizationId} (${context})`)
      return
    }

    const { data: members, error: membersError } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .neq('role', 'admin')

    if (membersError) {
      console.error(`[org-lock-notify] kunne ikke hente medlemmer org=${organizationId}:`, membersError.message)
      return
    }

    const memberIds = new Set((members ?? []).map(m => m.user_id as string))
    if (memberIds.size === 0) return

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

    if (emails.length === 0) {
      console.error(
        `[org-lock-notify] SKIPPED — fant ingen e-postadresser for ${memberIds.size} medlem(mer). ` +
        `org=${organizationId} (${context})`
      )
      return
    }

    const subject = `Tilgangen gjennom ${orgName} er avsluttet — Quizkanonen`
    const html = orgAccessEndedEmail(orgName)

    let sent = 0
    const BATCH = 20
    for (let i = 0; i < emails.length; i += BATCH) {
      const results = await Promise.allSettled(
        emails.slice(i, i + BATCH).map(email => sendEmail({ to: email, subject, html }))
      )
      for (const r of results) {
        if (r.status === 'fulfilled') sent++
        else console.error(`[org-lock-notify] sendEmail feilet org=${organizationId}:`, r.reason)
      }
    }

    console.log(`[org-lock-notify] varslet ${sent}/${emails.length} ansatte org=${organizationId} (${context})`)
  } catch (err) {
    console.error(`[org-lock-notify] uventet feil org=${organizationId} (${context}):`, err)
  }
}
