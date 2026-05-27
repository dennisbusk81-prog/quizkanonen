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

  // Profiles on trial: premium_status = true, premium_since 23–24 days ago
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('premium_status', true)
    .gte('premium_since', windowStart)
    .lte('premium_since', windowEnd)

  if (profilesError) {
    console.error('[cron/trial-reminders] profiles error:', profilesError.message)
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no trials ending soon' })
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

  // Resolve all auth users in parallel instead of one-by-one
  const userResults = await Promise.allSettled(
    profiles.map(profile => supabaseAdmin.auth.admin.getUserById(profile.id))
  )

  const emailsToSend: string[] = []
  let failed = 0

  for (const result of userResults) {
    if (result.status === 'rejected') { failed++; continue }
    const { data: { user }, error: userError } = result.value
    if (userError || !user?.email) { failed++; continue }
    emailsToSend.push(user.email)
  }

  // Send all emails in parallel, each with a 5-second timeout
  const sendResults = await Promise.allSettled(
    emailsToSend.map(email =>
      withTimeout(sendEmail({ to: email, subject, html }), 5_000)
    )
  )

  let sent = 0
  for (const r of sendResults) {
    if (r.status === 'fulfilled') {
      sent++
    } else {
      console.error('[cron/trial-reminders] failed to send:', r.reason)
      failed++
    }
  }

  return NextResponse.json({ sent, failed })
}
