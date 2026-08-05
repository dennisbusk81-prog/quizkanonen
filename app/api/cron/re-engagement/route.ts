import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { reEngagementEmail } from '@/lib/email-templates'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe'
import { dispatchInBatches } from '@/lib/notify-dispatch'

// Samme feilklasse som F4 i notify-subscribers: ruten manglet maxDuration og
// skrev re_engagement_sent_at ÉN gang, etter hele løkken. Et tidsavbrudd midt
// i løkken stemplet da ingen, og neste kjøring sendte «Vi savner deg» på nytt
// til folk som alt hadde fått den.
//
// Kandidatspørringen filtrerer allerede på `re_engagement_sent_at IS NULL`, så
// gjenopptakelsen faller på plass av seg selv når stemplingen først skjer
// underveis — det finnes ingen alt-eller-intet-sjekk å rydde bort her, slik
// det gjorde i notify-subscribers.
export const maxDuration = 60

const WORK_BUDGET_MS = 50_000
const BATCH_INTERVAL_MS = 1_000

// Send a single re-engagement email to users who:
//   a. have email_reminders = true
//   b. have re_engagement_sent_at IS NULL (never sent before — sent once per lifetime)
//   c. have last_seen_at older than 14 days
//   d. have played at least one quiz (have at least one row in attempts)
//
// Requires: ALTER TABLE profiles ADD COLUMN re_engagement_sent_at timestamptz;
// Cron: daily at 10:00 (Europe/Oslo), e.g. cron-job.org schedule "0 10 * * *"

const INACTIVE_DAYS = 14

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Step 1: Candidate profiles — opted in, never sent, inactive for 14+ days
  const { data: candidates, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name')
    .eq('email_reengagement', true)
    .is('re_engagement_sent_at', null)
    .lt('last_seen_at', cutoff)

  if (profilesError) {
    console.error('[cron/re-engagement] profiles error:', profilesError.message)
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no inactive candidates' })
  }

  // Step 2: Keep only users who have played at least once
  const candidateIds = candidates.map(p => p.id)

  const { data: activePlayers, error: attemptsError } = await supabaseAdmin
    .from('attempts')
    .select('user_id')
    .in('user_id', candidateIds)
    .not('user_id', 'is', null)

  if (attemptsError) {
    console.error('[cron/re-engagement] attempts error:', attemptsError.message)
    return NextResponse.json({ error: attemptsError.message }, { status: 500 })
  }

  const playedIds = new Set(
    (activePlayers ?? [])
      .map((r: { user_id: string | null }) => r.user_id)
      .filter((id): id is string => !!id)
  )

  const eligibleProfiles = candidates.filter(p => playedIds.has(p.id))

  if (eligibleProfiles.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no eligible users (none have played)' })
  }

  // Step 3: Resolve emails via listUsers pagination
  const eligibleIds = new Set(eligibleProfiles.map(p => p.id))
  const firstNameMap = new Map(
    eligibleProfiles.map(p => [
      p.id,
      (p.display_name as string | null)?.split(' ')[0] ?? undefined,
    ])
  )

  const emailMap = new Map<string, string>() // user_id → email
  let page = 1
  while (true) {
    const { data: authData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (listError) {
      console.error('[cron/re-engagement] listUsers error (page', page, '):', listError.message)
      break
    }
    const users = authData?.users ?? []
    for (const u of users) {
      if (u.email && eligibleIds.has(u.id)) {
        emailMap.set(u.id, u.email)
      }
    }
    if (users.length < 1000) break
    page++
  }

  if (emailMap.size === 0) {
    return NextResponse.json({ sent: 0, reason: 'no emails resolved' })
  }

  // Step 4: Send in batches — se EMAIL_BATCH_SIZE i lib/email-batch.ts
  const subject = 'Vi savner deg — quizen venter'
  const entries = [...emailMap.entries()] // [userId, email]

  // Step 5: stemples PER BATCH, ikke etter løkken. Blir funksjonen drept
  // underveis, er de leverte allerede merket og får aldri e-posten på nytt.
  const result = await dispatchInBatches<[string, string]>(
    entries,
    {
      send: ([userId, email]) => {
        const firstName = firstNameMap.get(userId)
        const html = reEngagementEmail(firstName, buildUnsubscribeUrl(userId, 'reengagement'))
        return sendEmail({ to: email, subject, html })
      },
      stamp: async delivered => {
        const { error } = await supabaseAdmin
          .from('profiles')
          .update({ re_engagement_sent_at: new Date().toISOString() })
          .in('id', delivered.map(([userId]) => userId))
        if (error) throw new Error(error.message)
      },
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      onSendError: ([userId], reason) => {
        console.error('[cron/re-engagement] send failed for', userId, '—', reason)
      },
      onStampError: reason => {
        console.error('[cron/re-engagement] stempling feilet, stopper kjøringen:', reason)
      },
    },
    { batchSize: EMAIL_BATCH_SIZE, minBatchIntervalMs: BATCH_INTERVAL_MS, budgetMs: WORK_BUDGET_MS },
  )

  console.log(
    `[cron/re-engagement] sent=${result.sent} failed=${result.failed} ` +
    `gjenstår=${result.remaining}` +
    (result.stoppedOnBudget ? ' (stoppet på tidsbudsjett — resten tas neste kjøring)' : '') +
    (result.stampFailed ? ' (STOPPET: stempling feilet)' : '')
  )
  return NextResponse.json({ sent: result.sent, failed: result.failed, remaining: result.remaining })
}
