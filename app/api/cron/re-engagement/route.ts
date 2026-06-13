import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { reEngagementEmail } from '@/lib/email-templates'

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

  // Step 4: Send in batches of 20
  const subject = 'Vi savner deg — quizen venter'
  const entries = [...emailMap.entries()] // [userId, email]

  let sent = 0
  let failed = 0
  const sentIds: string[] = []

  const BATCH_SIZE = 20
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(([userId, email]) => {
        const firstName = firstNameMap.get(userId)
        const html = reEngagementEmail(firstName)
        return sendEmail({ to: email, subject, html }).then(() => userId)
      })
    )
    for (const r of results) {
      if (r.status === 'fulfilled') {
        sent++
        sentIds.push(r.value)
      } else {
        console.error('[cron/re-engagement] send failed:', r.reason)
        failed++
      }
    }
  }

  // Step 5: Mark successfully sent users so they never receive this email again
  if (sentIds.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ re_engagement_sent_at: new Date().toISOString() })
      .in('id', sentIds)

    if (updateError) {
      console.error('[cron/re-engagement] failed to set re_engagement_sent_at:', updateError.message)
    }
  }

  console.log(`[cron/re-engagement] sent=${sent} failed=${failed}`)
  return NextResponse.json({ sent, failed })
}
