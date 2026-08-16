import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { trialEndingEmail, orgTrialEndingEmail } from '@/lib/email-templates'
import { getOrgAdminEmails, sendToOrgAdmins } from '@/lib/org-admin-emails'
import { hasActiveOrgPremium } from '@/lib/org-premium'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { dispatchInBatches } from '@/lib/notify-dispatch'

// Kandidatfasen henter Stripe-status i ETT listekall (se sendB2CTrialReminders),
// ikke lenger ett retrieve per kandidat — 8. august tok 58 sekvensielle kall
// ~25–40 s alene, hele kjøringen brøt cron-job.orgs 30 s-kutt, og jobben ble
// deaktivert med Timeout-symptomet. maxDuration beholdes som takhøyde for
// utsendingsfasen (dispatchInBatches har eget 50 s-budsjett).
// Org-grenen under stempler allerede per organisasjon, inne i løkken — det er
// B2C-grenen som hadde stemplingen etter løkken.
export const maxDuration = 60

const WORK_BUDGET_MS = 50_000
const BATCH_INTERVAL_MS = 1_000

// Sender påminnelse til org-admin når en B2B-trial nærmer seg slutt (innen 2 døgn)
// og ikke allerede er påminnet. Stempler organizations.trial_reminder_sent_at for
// å unngå dobbel-sending. I dry-run beregnes kandidatene, men ingenting sendes/stemples.
async function sendOrgTrialReminders(now: number, dryRun: boolean): Promise<number> {
  const windowEnd = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date(now).toISOString()

  const { data: orgs, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, stripe_period_end')
    .eq('subscription_status', 'trialing')
    .not('stripe_period_end', 'is', null)
    .gte('stripe_period_end', nowIso)
    .lte('stripe_period_end', windowEnd)
    .is('trial_reminder_sent_at', null)

  if (error) {
    console.error('[cron/trial-reminders] org query error:', error.message)
    return 0
  }
  if (!orgs || orgs.length === 0) return 0

  let orgSent = 0
  for (const org of orgs) {
    // Alle admins i orgen — ikke bare én vilkårlig valgt.
    const { emails } = await getOrgAdminEmails(org.id)
    if (emails.length === 0 || !org.stripe_period_end) continue

    if (dryRun) {
      orgSent++ // ville sendt
      continue
    }

    const { delivered } = await sendToOrgAdmins(
      emails,
      {
        subject: `Prøveperioden er snart over — ${org.name}`,
        html: orgTrialEndingEmail(org.name, org.slug, org.stripe_period_end),
      },
      `cron/trial-reminders org=${org.id}`,
    )

    if (delivered.length === 0) {
      console.error('[cron/trial-reminders] ingen av', emails.length, 'admin-e-poster gikk gjennom for', org.slug)
      continue
    }

    // Stempelet er per ORG, men sendingene er per ADMIN (16. august 2026).
    // Fram til nå holdt det at ÉN av admin-ene fikk e-posten: orgen ble
    // stemplet, og de øvrige ble aldri forsøkt igjen — kandidatspørringen
    // filtrerer på `trial_reminder_sent_at IS NULL`, så en stemplet org er
    // usynlig for alle senere kjøringer. Derfor stemples det KUN ved full
    // leveranse. Ved delvis leveranse står stempelet, og neste kjøring tar
    // hele orgen på nytt — de som alt fikk e-posten kan da få den én gang
    // til. Duplikat til 1–2 admins er den billige feilen; en admin som aldri
    // får vite at prøveperioden løper ut er den dyre. Samme avveining som
    // grace-påminnelsen i expire-grace-periods.
    if (delivered.length < emails.length) {
      console.error(
        `[cron/trial-reminders] delvis leveranse (${delivered.length}/${emails.length} admins) for`,
        org.slug, '— stempler IKKE; hele orgen tas på nytt neste kjøring',
      )
      continue
    }

    const { error: stampErr } = await supabaseAdmin.from('organizations')
      .update({ trial_reminder_sent_at: new Date(now).toISOString() })
      .eq('id', org.id)
    if (stampErr) {
      console.error('[cron/trial-reminders] stempling feilet for', org.slug, '— kan gi duplikat neste kjøring:', stampErr.message)
    }
    orgSent++
  }
  return orgSent
}

const DAY_MS = 24 * 60 * 60 * 1000
// Send B2C-påminnelse når trial_end er mellom 6 og 8 dager unna. Vinduet er 3 dager
// bredt som sikkerhetsnett hvis cronen skulle hoppe over en dag; trial_reminder_sent_at
// hindrer dobbel-sending innenfor vinduet.
const REMINDER_MIN_DAYS = 6
const REMINDER_MAX_DAYS = 8

type B2CRecipient = { id: string; email: string; subId: string; trialEnd: number; daysLeft: number }
type B2CResult = { candidates: number; recipients: B2CRecipient[]; sent: number; failed: number; error?: string }

// Wrap a promise with a per-call timeout so one hanging call can't block the whole job.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    ),
  ])
}

// B2C-trials: finn profiler med et personlig Stripe-abonnement der Stripe rapporterer
// status 'trialing', og slå opp faktisk trial_end fra Stripe. Ingen antagelse om 30 dager.
async function sendB2CTrialReminders(now: number, dryRun: boolean): Promise<B2CResult> {
  // Kandidatpool: aktive founders/uspesifiserte trials med et personlig abonnement,
  // som ennå ikke er påminnet. Betalende (premium_source 'personal'/'org') er ekskludert.
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, personal_stripe_subscription_id')
    .eq('premium_status', true)
    .not('personal_stripe_subscription_id', 'is', null)
    .or('premium_source.is.null,premium_source.eq.founders')
    .is('trial_reminder_sent_at', null)

  if (profilesError) {
    console.error('[cron/trial-reminders] profiles error:', profilesError.message)
    return { candidates: 0, recipients: [], sent: 0, failed: 0, error: profilesError.message }
  }
  if (!profiles || profiles.length === 0) {
    return { candidates: 0, recipients: [], sent: 0, failed: 0 }
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })

  // ALLE trialing-abonnementer i 1–2 listekall, i stedet for ett retrieve per
  // kandidat. Fram til 16. august gjorde løkken under `subscriptions.retrieve`
  // sekvensielt per kandidat (~450–500 ms hver): 8. august ga 58 kandidater
  // ~25–40 s kandidatfase, kjøringen brøt cron-job.orgs 30 s-klientkutt, og
  // jobben ble deaktivert som «Timeout». Listekallet henter nøyaktig de samme
  // to feltene (status via filteret, trial_end på objektet) uansett kohort-
  // størrelse. Paginering via has_more, samme mønster som listAllSubscriptions
  // i scripts/backfill-has-used-trial.mjs — limit er 100 per side hos Stripe,
  // så uten løkken forsvinner kandidat nr. 101+ stille.
  const trialingBySubId = new Map<string, Stripe.Subscription>()
  let startingAfter: string | undefined
  while (true) {
    let page: Stripe.ApiList<Stripe.Subscription>
    try {
      page = await stripe.subscriptions.list({
        status: 'trialing',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
    } catch (err) {
      // Feiler listekallet, vet vi ingenting om noen kandidat. Å sende
      // ingenting er trygt (ingen stempling → neste kjøring prøver på nytt),
      // og feilen skal synes: GET-en svarer 500 når error er satt.
      console.error('[cron/trial-reminders] subscriptions.list failed:', err)
      return {
        candidates: profiles.length, recipients: [], sent: 0, failed: 0,
        error: 'stripe subscriptions.list failed',
      }
    }
    for (const sub of page.data) trialingBySubId.set(sub.id, sub)
    if (!page.has_more || page.data.length === 0) break
    startingAfter = page.data[page.data.length - 1].id
  }

  // Behold kun kandidater som fortsatt er 'trialing' og hvis trial_end ligger
  // 6–8 dager frem i tid.
  const recipients: B2CRecipient[] = []
  for (const p of profiles) {
    const subId = p.personal_stripe_subscription_id as string
    // Ikke i trialing-listen = ikke lenger 'trialing' (konvertert, kansellert
    // eller ukjent id) — samme semantikk som forgjengerens status-sjekk per
    // kandidat, bare uten Stripe-kall.
    const sub = trialingBySubId.get(subId)
    if (!sub || !sub.trial_end) continue

    const daysLeft = (sub.trial_end * 1000 - now) / DAY_MS
    if (daysLeft < REMINDER_MIN_DAYS || daysLeft > REMINDER_MAX_DAYS) continue

    // Hopp over hvis brukeren uansett har aktiv Premium via org — da mister de
    // ingenting når det personlige trial-abonnementet utløper, og påminnelsen forvirrer.
    if (await hasActiveOrgPremium(p.id)) {
      console.log(`[cron/trial-reminders] hopper over ${p.id} — aktiv Premium via org`)
      continue
    }

    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(p.id)
    const email = authData.user?.email
    if (!email) continue

    recipients.push({ id: p.id, email, subId, trialEnd: sub.trial_end, daysLeft: Math.round(daysLeft) })
  }

  if (dryRun || recipients.length === 0) {
    return { candidates: profiles.length, recipients, sent: 0, failed: 0 }
  }

  // Send i batcher, med 5-sekunders timeout per kall, og STEMPLE PER BATCH.
  //
  // To ting var galt her, samme feilklasse som F4 i notify-subscribers:
  //   • Alle mottakerne gikk av gårde i ÉN Promise.allSettled — ingen
  //     batching i det hele tatt. Ved nok trials sprenger det Resends grense
  //     på 10 forespørsler i sekundet i ett jafs.
  //   • trial_reminder_sent_at ble skrevet én gang, etter at alt var sendt.
  //     Et tidsavbrudd stemplet da ingen, og neste kjøring sendte «X dager
  //     igjen» på nytt til de som alt hadde fått den.
  //
  // Kandidatspørringen filtrerer allerede på `trial_reminder_sent_at IS NULL`,
  // så gjenopptakelsen faller på plass når stemplingen skjer underveis.
  const result = await dispatchInBatches<B2CRecipient>(
    recipients,
    {
      send: ({ email, daysLeft }) =>
        withTimeout(
          sendEmail({
            to: email,
            subject: `${daysLeft} dager igjen av din gratis prøveperiode`,
            html: trialEndingEmail(daysLeft),
          }),
          5_000,
        ),
      stamp: async delivered => {
        const { error } = await supabaseAdmin
          .from('profiles')
          .update({ trial_reminder_sent_at: new Date().toISOString() })
          .in('id', delivered.map(d => d.id))
        if (error) throw new Error(error.message)
      },
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      onSendError: (r, reason) => {
        console.error('[cron/trial-reminders] failed to send to', r.id, '—', reason)
      },
      onStampError: reason => {
        console.error('[cron/trial-reminders] stempling feilet, stopper kjøringen:', reason)
      },
    },
    { batchSize: EMAIL_BATCH_SIZE, minBatchIntervalMs: BATCH_INTERVAL_MS, budgetMs: WORK_BUDGET_MS },
  )

  if (result.stoppedOnBudget) {
    console.log(`[cron/trial-reminders] stoppet på tidsbudsjett — ${result.remaining} gjenstår til neste kjøring`)
  }

  return { candidates: profiles.length, recipients, sent: result.sent, failed: result.failed }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?dry-run=1 (eller ?dryRun=1): beregn og vis hvem som VILLE fått påminnelse,
  // uten å sende e-post eller stemple noe.
  const params = new URL(request.url).searchParams
  const dryRun = params.get('dry-run') === '1' || params.get('dryRun') === '1'

  const now = Date.now()

  const orgSent = await sendOrgTrialReminders(now, dryRun)
  const b2c = await sendB2CTrialReminders(now, dryRun)

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      orgWouldSend: orgSent,
      b2cCandidates: b2c.candidates,
      b2cWouldSend: b2c.recipients.length,
      b2cRecipients: b2c.recipients.map(r => ({
        email: r.email,
        subId: r.subId,
        daysLeft: r.daysLeft,
        trialEnd: new Date(r.trialEnd * 1000).toISOString(),
      })),
      ...(b2c.error ? { b2cError: b2c.error } : {}),
    })
  }

  if (b2c.error) {
    return NextResponse.json({ error: b2c.error, orgSent }, { status: 500 })
  }
  return NextResponse.json({ sent: b2c.sent, failed: b2c.failed, orgSent })
}
