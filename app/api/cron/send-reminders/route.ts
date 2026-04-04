import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { quizReminderEmail } from '@/lib/email-templates'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find the next upcoming quiz
  const { data: nextQuiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at')
    .gt('opens_at', new Date().toISOString())
    .order('opens_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (quizError) {
    console.error('[cron/send-reminders] quiz lookup error:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 500 })
  }

  if (!nextQuiz) {
    return NextResponse.json({ sent: 0, reason: 'no upcoming quiz' })
  }

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
    return NextResponse.json({ sent: 0, reason: 'no subscribers' })
  }

  const html = quizReminderEmail(nextQuiz.opens_at)
  let sent = 0
  let failed = 0

  for (const profile of profiles) {
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id)

    if (userError || !user?.email) {
      console.warn('[cron/send-reminders] no email for user:', profile.id)
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
