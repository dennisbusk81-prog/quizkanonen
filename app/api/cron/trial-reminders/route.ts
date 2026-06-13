import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { trialEndingEmail } from '@/lib/email-templates'

const DAYS_LEFT = 7
// Window: users whose premium_since is between 23 and 24 days ago (caught once per daily run)
const WINDOW_START_MS = 24 * 24 * 60 * 60 * 1000
const WINDOW_END_MS   = 23 * 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const windowStart = new Date(now - WINDOW_START_MS).toISOString()
  const windowEnd   = new Date(now - WINDOW_END_MS).toISOString()

  // Profiles on trial: premium_status = true, premium_since 23–24 days ago,
  // premium_source NULL (Founders) or 'founders', and reminder not already sent.
  // Paying customers (premium_source = 'personal' or 'org') are excluded.
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('premium_status', true)
    .gte('premium_since', windowStart)
    .lte('premium_since', windowEnd)
    .or('premium_source.is.null,premium_source.eq.founders')
    .is('trial_reminder_sent_at', null)

  if (profilesError) {
    console.error('[cron/trial-reminders] profiles error:', profilesError.message)
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no trials ending soon' })
  }

  const trialUserIds = new Set(profiles.map(p => p.id))

  // Resolve emails via listUsers pagination — avoids N parallel getUserById calls.
  // Keep a Map<userId, email> so we can mark sent rows after delivery.
  const toSend: { id: string; email: string }[] = []
  let page = 1
  while (true) {
    const { data: authData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (listError) {
      console.error('[cron/trial-reminders] listUsers error (page', page, '):', listError.message)
      break
    }
    const users = authData?.users ?? []
    for (const u of users) {
      if (u.email && trialUserIds.has(u.id)) {
        toSend.push({ id: u.id, email: u.email })
      }
    }
    if (users.length < 1000) break // last page
    page++
  }

  if (toSend.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no emails resolved for trial users' })
  }

  const html = trialEndingEmail(DAYS_LEFT)
  const subject = `${DAYS_LEFT} dager igjen av din gratis prøveperiode`

  // Wrap a promise with a per-call timeout so one hanging email can't block the
  // entire cron job.
  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
      ),
    ])
  }

  // Send all emails in parallel, each with a 5-second timeout.
  // Track which user IDs succeeded so we can stamp trial_reminder_sent_at.
  const sentAt = new Date().toISOString()
  const sendResults = await Promise.allSettled(
    toSend.map(({ id, email }) =>
      withTimeout(sendEmail({ to: email, subject, html }), 5_000).then(() => id)
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

  // Mark sent rows — prevents double-send if cron fires twice on the same day.
  if (sentIds.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ trial_reminder_sent_at: sentAt })
      .in('id', sentIds)
    if (updateError) {
      console.error('[cron/trial-reminders] failed to stamp trial_reminder_sent_at:', updateError.message)
    }
  }

  return NextResponse.json({ sent, failed })
}
