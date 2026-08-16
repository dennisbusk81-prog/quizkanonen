/**
 * Org-admin-mottakere (29. juli 2026).
 *
 * Bakgrunn: FIRE steder hentet «org-admin sin e-post» med
 * `.eq('role','admin').limit(1).maybeSingle()` — Stripe-webhooken (fire
 * varsler), cron/weekly-report, cron/trial-reminders og
 * admin/org-resend-purchase. En org kan ha flere admins (org-admin-siden
 * lar en admin forfremme kolleger, og `leave`-ruten teller eksplisitt
 * admins for å hindre at den siste går ut). Admin nr. 2+ fikk aldri noe:
 * ikke kjøpsbekreftelse, ikke fornyelse, ikke betalingsfeil, ikke
 * kansellering, ikke trial-påminnelse, ikke ukesrapport.
 *
 * `limit(1)` var dessuten uten `order by` — hvilken av admin-ene som fikk
 * e-posten var i praksis vilkårlig.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmailToMany, type BulkSendResult } from '@/lib/send-email-many'

export type OrgAdminRecipients = {
  /** Alle admins med e-postadresse. Tom liste = ingen å sende til. */
  emails: string[]
  orgName: string | null
  orgSlug: string | null
}

/**
 * Henter e-postadressene til ALLE admins i en org, sammen med org-navn og
 * slug (som malene trenger).
 *
 * Kaster aldri: feil logges og gir tom mottakerliste, slik at kallstedene
 * kan behandle «fant ingen» og «feilet» likt — de skal uansett ikke sende.
 */
export async function getOrgAdminEmails(organizationId: string): Promise<OrgAdminRecipients> {
  const empty: OrgAdminRecipients = { emails: [], orgName: null, orgSlug: null }

  try {
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('name, slug')
      .eq('id', organizationId)
      .maybeSingle()

    if (orgError) {
      console.error(`[org-admin-emails] org-oppslag feilet org=${organizationId}:`, orgError.message)
      return empty
    }

    const { data: adminMembers, error: membersError } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role', 'admin')

    if (membersError) {
      console.error(`[org-admin-emails] admin-oppslag feilet org=${organizationId}:`, membersError.message)
      return { emails: [], orgName: org?.name ?? null, orgSlug: org?.slug ?? null }
    }

    const adminIds = (adminMembers ?? []).map(m => m.user_id as string)
    if (adminIds.length === 0) {
      // Org uten admin i det hele tatt. Ikke en feil vi kan rette her, men
      // den skal være synlig i loggen — det betyr at ingen i bedriften kan
      // administrere abonnementet.
      console.error(`[org-admin-emails] org=${organizationId} har INGEN admin-medlemmer`)
      return { emails: [], orgName: org?.name ?? null, orgSlug: org?.slug ?? null }
    }

    // Admins er få (typisk 1–3), så ett oppslag hver er billigere enn en
    // paginert listUsers over hele brukerbasen.
    const lookups = await Promise.allSettled(
      adminIds.map(id => supabaseAdmin.auth.admin.getUserById(id))
    )

    const emails: string[] = []
    lookups.forEach((r, idx) => {
      if (r.status === 'rejected') {
        console.error(`[org-admin-emails] getUserById feilet for ${adminIds[idx]} (org=${organizationId}):`, r.reason)
        return
      }
      const email = r.value?.data?.user?.email
      if (email) emails.push(email)
      else console.error(`[org-admin-emails] admin ${adminIds[idx]} mangler e-postadresse (org=${organizationId})`)
    })

    return { emails, orgName: org?.name ?? null, orgSlug: org?.slug ?? null }
  } catch (err) {
    console.error(`[org-admin-emails] uventet feil org=${organizationId}:`, err)
    return empty
  }
}

/**
 * Sender samme melding til alle admins i en org. Kaster aldri.
 * Returnerer `{ sent: 0, failed: 0 }` når det ikke fantes noen å sende til.
 */
export async function sendToOrgAdmins(
  emails: string[],
  message: { subject: string; html: string; from?: string },
  context: string,
): Promise<BulkSendResult> {
  if (emails.length === 0) return { sent: 0, failed: 0, delivered: [] }
  return sendEmailToMany(emails, message, context)
}
