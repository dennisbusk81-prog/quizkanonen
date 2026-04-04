import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { quizReminderEmail } from '@/lib/email-templates'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find a quiz opening in the 55–65 minute window from now
  const now = Date.now()
  const windowStart = new Date(now + 55 * 60 * 1000).toISOString()
  const windowEnd   = new Date(now + 65 * 60 * 1000).toISOString()

  console.log('[cron/send-reminders] window:', { windowStart, windowEnd })

  const { data: nextQuiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at')
    .gte('opens_at', windowStart)
    .lte('opens_at', windowEnd)
    .order('opens_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (quizError) {
    console.error('[cron/send-reminders] quiz lookup error:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 500 })
  }

  if (!nextQuiz) {
    console.log('[cron/send-reminders] no quiz in window, skipping')
    return NextResponse.json({ skipped: true, reason: 'No quiz opening soon' })
  }

  console.log('[cron/send-reminders] quiz found:', { title: nextQuiz.title, opens_at: nextQuiz.opens_at })

  // Fetch profiles that have opted in to reminders
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email_reminders', true)

  if (profilesError) {
    console.error('[cron/send-reminders] profiles error:', profilesError.message)
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  if (!profiles || profiles.length === 0) {
    console.log('[cron/send-reminders] no subscribers with email_reminders=true')
    return NextResponse.json({ sent: 0, reason: 'no subscribers' })
  }

  console.log('[cron/send-reminders] subscribers:', profiles.length)

  const html = quizReminderEmail(nextQuiz.opens_at)
  let sent = 0
  let failed = 0

  for (const profile of profiles) {
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id)

    if (userError) {
      console.error('[cron/send-reminders] getUserById failed for:', profile.id, userError.message)
      failed++
      continue
    }
    if (!user?.email) {
      console.warn('[cron/send-reminders] no email address for user:', profile.id)
      failed++
      continue
    }

    try {
      await sendEmail({
        to: user.email,
        subject: `Quizen åpner snart — ${new Date(nextQuiz.opens_at).toLocaleDateString('no-NO')}`,
        html,
      })
      sent++
    } catch (err) {
      console.error('[cron/send-reminders] failed to send to:', user.email, err)
      failed++
    }
  }

  console.log(`[cron/send-reminders] quiz="${nextQuiz.title}" sent=${sent} failed=${failed}`)
  return NextResponse.json({ sent, failed, quiz: nextQuiz.title })
}
