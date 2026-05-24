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
    return NextResponse.json({ skipped: true, reason: 'No quiz opening soon' })
  }

  // Fetch profile IDs that have opted in to reminders
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

  const subscriberIds = new Set(profiles.map(p => p.id))

  // FIX 6 — paginate auth.admin.listUsers instead of calling getUserById per profile.
  // This avoids N sequential API calls (one per subscriber) and scales to large user bases.
  const emailsByUserId = new Map<string, string>()
  let page = 1
  while (true) {
    const { data: authData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (listError) {
      console.error('[cron/send-reminders] listUsers error (page', page, '):', listError.message)
      break
    }
    const users = authData?.users ?? []
    for (const u of users) {
      if (u.email && subscriberIds.has(u.id)) {
        emailsByUserId.set(u.id, u.email)
      }
    }
    if (users.length < 1000) break // last page
    page++
  }

  const emailsToSend = [...emailsByUserId.values()]
  if (emailsToSend.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no subscriber emails found' })
  }

  const html = quizReminderEmail(nextQuiz.opens_at)
  const subject = `Quizen åpner snart — ${new Date(nextQuiz.opens_at).toLocaleDateString('no-NO')}`
  let sent = 0
  let failed = 0

  // FIX 6 — send in batches of 20 concurrent emails (avoids overwhelming the email provider)
  const BATCH_SIZE = 20
  for (let i = 0; i < emailsToSend.length; i += BATCH_SIZE) {
    const batch = emailsToSend.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(email => sendEmail({ to: email, subject, html }))
    )
    sent   += results.filter(r => r.status === 'fulfilled').length
    failed += results.filter(r => r.status === 'rejected').length
  }

  console.log(`[cron/send-reminders] quiz="${nextQuiz.title}" sent=${sent} failed=${failed}`)
  return NextResponse.json({ sent, failed, quiz: nextQuiz.title })
}
