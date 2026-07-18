import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { trialEndingEmail, orgTrialEndingEmail } from '@/lib/email-templates'

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
    // Finn org-admin sin e-post
    const { data: adminMember } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle()
    if (!adminMember) continue

    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(adminMember.user_id)
    const email = authData.user?.email
    if (!email || !org.stripe_period_end) continue

    if (dryRun) {
      orgSent++ // ville sendt
      continue
    }

    try {
      await sendEmail({
        to: email,
        subject: `Prøveperioden er snart over — ${org.name}`,
        html: orgTrialEndingEmail(org.name, org.slug, org.stripe_period_end),
      })
      await supabaseAdmin.from('organizations')
        .update({ trial_reminder_sent_at: new Date(now).toISOString() })
        .eq('id', org.id)
      orgSent++
    } catch (err) {
      console.error('[cron/trial-reminders] org reminder failed for', org.slug, err)
    }
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

  // For hver kandidat: hent abonnementet fra Stripe, behold kun de som fortsatt er
  // 'trialing' og hvis trial_end ligger 6–8 dager frem i tid.
  const recipients: B2CRecipient[] = []
  for (const p of profiles) {
    const subId = p.personal_stripe_subscription_id as string
    let sub: Stripe.Subscription
    try {
      sub = await stripe.subscriptions.retrieve(subId)
    } catch (err) {
      console.error('[cron/trial-reminders] failed to retrieve sub', subId, err)
      continue
    }
    if (sub.status !== 'trialing' || !sub.trial_end) continue

    const daysLeft = (sub.trial_end * 1000 - now) / DAY_MS
    if (daysLeft < REMINDER_MIN_DAYS || daysLeft > REMINDER_MAX_DAYS) continue

    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(p.id)
    const email = authData.user?.email
    if (!email) continue

    recipients.push({ id: p.id, email, subId, trialEnd: sub.trial_end, daysLeft: Math.round(daysLeft) })
  }

  if (dryRun || recipients.length === 0) {
    return { candidates: profiles.length, recipients, sent: 0, failed: 0 }
  }

  // Send påminnelser parallelt, hver med 5-sekunders timeout. Bruk faktisk dager-igjen
  // per bruker i emnefelt/innhold.
  const sentAt = new Date().toISOString()
  const sendResults = await Promise.allSettled(
    recipients.map(({ id, email, daysLeft }) =>
      withTimeout(
        sendEmail({
          to: email,
          subject: `${daysLeft} dager igjen av din gratis prøveperiode`,
          html: trialEndingEmail(daysLeft),
        }),
        5_000,
      ).then(() => id)
    )
  )

  const sentIds: string[] = []
  let sent = 0
  let failed = 0
  for (const r of sendResults) {
    if (r.status === 'fulfilled') {
      sentIds.push(r.value)
      sent++
    } else {
      console.error('[cron/trial-reminders] failed to send:', r.reason)
      failed++
    }
  }

  // Stemple sendte rader — hindrer dobbel-sending hvis cronen fyrer flere ganger.
  if (sentIds.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ trial_reminder_sent_at: sentAt })
      .in('id', sentIds)
    if (updateError) {
      console.error('[cron/trial-reminders] failed to stamp trial_reminder_sent_at:', updateError.message)
    }
  }

  return { candidates: profiles.length, recipients, sent, failed }
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
