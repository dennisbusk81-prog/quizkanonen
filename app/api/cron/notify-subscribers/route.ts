import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // Find a quiz that has just opened (opens_at within the last 10 minutes)
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at')
    .lte('opens_at', now.toISOString())
    .gte('opens_at', tenMinAgo)
    .order('opens_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!quiz) {
    return NextResponse.json({ skipped: true, reason: 'No quiz opened in the last 10 minutes' })
  }

  // Check if we already notified for this quiz
  const { data: alreadyNotified } = await supabaseAdmin
    .from('quiz_notifications')
    .select('id')
    .eq('notified_quiz_id', quiz.id)
    .limit(1)
    .maybeSingle()

  if (alreadyNotified) {
    return NextResponse.json({ skipped: true, reason: 'Already notified for this quiz' })
  }

  const quizSnapshot = quiz

  waitUntil(
    (async () => {
      // Fetch all subscribers (notify everyone for this quiz, dedup done above)
      const { data: subscribers } = await supabaseAdmin
        .from('quiz_notifications')
        .select('id, email')

      if (!subscribers || subscribers.length === 0) {
        console.log('[cron/notify-subscribers] no subscribers to notify')
        return
      }

      const html = `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ukens quiz er klar!</title>
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">
              <p style="margin:0 0 8px;font-family:Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Ukens quiz er klar!
              </p>
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>
              ${quizSnapshot.title ? `<p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#c9a84c;">${quizSnapshot.title}</p>` : ''}
              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Ukens quiz på Quizkanonen er nå åpen. Spill nå og se hvor du havner på topplisten!
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#c9a84c;border-radius:10px;padding:13px 32px;text-align:center;">
                    <a href="https://quizkanonen.no" style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1c23;text-decoration:none;white-space:nowrap;">
                      Spill nå →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;color:#7a7873;text-align:center;line-height:1.6;">
                Du mottok denne e-posten fordi du meldte deg på varsler på quizkanonen.no.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

      const subject = `Ukens quiz er klar — ${quizSnapshot.title ?? 'Quizkanonen'}`
      const ids = subscribers.map(s => s.id)
      let sent = 0
      let failed = 0

      const BATCH_SIZE = 20
      for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
        const batch = subscribers.slice(i, i + BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map(s => sendEmail({ to: s.email, subject, html }))
        )
        sent   += results.filter(r => r.status === 'fulfilled').length
        failed += results.filter(r => r.status === 'rejected').length
      }

      // Mark all as notified
      if (sent > 0) {
        await supabaseAdmin
          .from('quiz_notifications')
          .update({ notified_at: now.toISOString(), notified_quiz_id: quizSnapshot.id })
          .in('id', ids)
      }

      console.log(`[cron/notify-subscribers] quiz="${quizSnapshot.title}" sent=${sent} failed=${failed}`)
    })()
  )

  return NextResponse.json({ ok: true })
}
