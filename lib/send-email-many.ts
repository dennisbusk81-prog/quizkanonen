/**
 * Batchet e-postsending til flere mottakere (29. juli 2026).
 *
 * Trukket ut fordi tre steder nå trenger nøyaktig samme oppførsel: alle
 * ansatte i en org (lib/org-lock-notify.ts), alle admins i en org
 * (lib/org-admin-emails.ts), og påminnelsesutsendingen som først etablerte
 * mønsteret (app/api/org/[slug]/send-reminder/route.ts).
 *
 * Kontrakten er den viktige biten: én mottaker som feiler skal ikke stoppe
 * de øvrige, og ingen feil skal forsvinne stille.
 */
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'

export type BulkSendResult = {
  sent: number
  failed: number
  /**
   * Adressene som faktisk ble levert (16. august 2026). Informasjonen lå
   * allerede i Promise.allSettled-resultatene, men ble kastet — og da kunne
   * kallstedene bare gate på «minst én lyktes». Det stemplet bort mottakere
   * som fikk 429 i samme kjøring (trial-reminders org-grenen og
   * remindOrgGrace i expire-grace-periods). Stempling skal sammenlignes mot
   * `delivered`, aldri mot `sent > 0`.
   */
  delivered: string[]
}

/**
 * Sender samme melding til alle mottakerne, i batcher.
 *
 * Kaster ALDRI — flere av kallstedene ligger i den betalingskritiske
 * webhooken, der en e-postfeil aldri skal velte hendelsesbehandlingen eller
 * trigge en Stripe-retry. Hver enkelt feil logges med `console.error` og
 * `context`, slik at den er søkbar i Vercel-loggen.
 */
export async function sendEmailToMany(
  recipients: string[],
  message: { subject: string; html: string; from?: string },
  context: string,
): Promise<BulkSendResult> {
  let sent = 0
  let failed = 0
  const delivered: string[] = []

  for (let i = 0; i < recipients.length; i += EMAIL_BATCH_SIZE) {
    const batch = recipients.slice(i, i + EMAIL_BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(to => sendEmail({ to, ...message }))
    )
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        sent++
        delivered.push(batch[idx])
      } else {
        failed++
        console.error(`[send-email-many] sending feilet for ${batch[idx]} (${context}):`, r.reason)
      }
    })
  }

  return { sent, failed, delivered }
}
