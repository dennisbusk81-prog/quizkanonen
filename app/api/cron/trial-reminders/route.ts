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
  let sent = 0
  let failed = 0

  for (const profile of profiles) {
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id)

    if (userError) {
      console.error('[cron/trial-reminders] getUserById failed for:', profile.id, userError.message)
      failed++
      continue
    }
    if (!user?.email) {
      failed++
      continue
    }

    try {
      await sendEmail({
        to: user.email,
        subject: `${DAYS_LEFT} dager igjen av din gratis prøveperiode`,
        html,
      })
      sent++
    } catch (err) {
      console.error('[cron/trial-reminders] failed to send to:', user.email, err)
      failed++
    }
  }

  return NextResponse.json({ sent, failed })
}
