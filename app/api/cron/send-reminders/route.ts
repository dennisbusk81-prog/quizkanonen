import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { quizReminderEmail } from '@/lib/email-templates'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()

  // Early exit: bail immediately if no quiz opens within the next 90 minutes.
  // This is a cheap single-row query that lets the cron job return in < 100 ms
  // on the vast majority of runs where no reminder is needed.
  const { data: anyUpcoming } = await supabaseAdmin
    .from('quizzes')
    .select('id')
    .gte('opens_at', new Date(now).toISOString())
    .lte('opens_at', new Date(now + 90 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle()

  if (!anyUpcoming) {
    return NextResponse.json({ skipped: true, reason: 'No quiz opening within 90 minutes' })
  }

  // Find a quiz opening in the precise 55–65 minute reminder window.
  // Also check reminder_sent_at IS NULL to prevent double-sends if the cron
  // fires more than once within the window (e.g. retry or overlapping schedules).
  const windowStart = new Date(now + 55 * 60 * 1000).toISOString()
  const windowEnd   = new Date(now + 65 * 60 * 1000).toISOString()

  const { data: nextQuiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, reminder_sent_at')
    .gte('opens_at', windowStart)
    .lte('opens_at', windowEnd)
    .is('reminder_sent_at', null)
    .order('opens_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (quizError) {
    console.error('[cron/send-reminders] quiz lookup error:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 500 })
  }

  if (!nextQuiz) {
    return NextResponse.json({ skipped: true, reason: 'No quiz in reminder window (or already sent)' })
  }

  // A quiz is in the reminder window — return 200 immediately and do the
  // heavy lifting (profile lookup, auth pagination, email sending) in the
  // background via waitUntil so cron-job.org never sees a timeout.
  const quizSnapshot = nextQuiz // capture for the closure

  waitUntil(
    (async () => {
      // Fetch profile IDs that have opted in to reminders
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email_reminders', true)

      if (profilesError) {
        console.error('[cron/send-reminders] profiles error:', profilesError.message)
        return
      }

      if (!profiles || profiles.length === 0) {
        console.log('[cron/send-reminders] no subscribers — nothing to send')
        return
      }

      const subscriberIds = new Set(profiles.map(p => p.id))

      // Paginate auth.admin.listUsers to resolve subscriber emails in bulk
      // (avoids N sequential getUserById calls).
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
        console.log('[cron/send-reminders] no subscriber emails found')
        return
      }

      const html = quizReminderEmail(quizSnapshot.opens_at, quizSnapshot.title ?? undefined)
      const subject = `Quizen åpner snart — ${new Date(quizSnapshot.opens_at).toLocaleDateString('no-NO')}`
      let sent = 0
      let failed = 0

      // Send in batches of 20 concurrent emails
      const BATCH_SIZE = 20
      for (let i = 0; i < emailsToSend.length; i += BATCH_SIZE) {
        const batch = emailsToSend.slice(i, i + BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map(email => sendEmail({ to: email, subject, html }))
        )
        sent   += results.filter(r => r.status === 'fulfilled').length
        failed += results.filter(r => r.status === 'rejected').length
      }

      // Mark the quiz so a re-run of the cron does not send duplicate emails
      if (sent > 0) {
        const { error: markError } = await supabaseAdmin
          .from('quizzes')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', quizSnapshot.id)
        if (markError) {
          console.error('[cron/send-reminders] failed to set reminder_sent_at:', markError.message)
        }
      }

      console.log(`[cron/send-reminders] quiz="${quizSnapshot.title}" sent=${sent} failed=${failed}`)
    })()
  )

  return NextResponse.json({ ok: true })
}
