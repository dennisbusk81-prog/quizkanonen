import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { fetchAllRows } from '@/lib/paginate'
import { quizOpenedEmail } from '@/lib/email-templates'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe'

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
      // Fetch all subscribers (notify everyone for this quiz, dedup done above).
      // Paginert full henting — ellers ville abonnenter over rad 1000 stille
      // aldri fått denne (eller noen fremtidig) quiz-åpnet-e-post.
      const subscribers = await fetchAllRows<{ id: string; email: string }>((from, to) =>
        supabaseAdmin
          .from('quiz_notifications')
          .select('id, email')
          .range(from, to)
      )

      if (subscribers.length === 0) {
        console.log('[cron/notify-subscribers] no subscribers to notify')
        return
      }

      // Malen bygges PER MOTTAKER, ikke én gang for alle: avmeldingslenken er
      // signert med abonnentens egen rad-id, så den kan ikke deles på tvers.
      // Emnefeltet er ren tekst og skal IKKE escapes — der ville `&amp;` blitt
      // stående synlig.
      const subject = `Ukens quiz er klar — ${quizSnapshot.title ?? 'Quizkanonen'}`
      const sentIds: string[] = []
      let sent = 0
      let failed = 0

      for (let i = 0; i < subscribers.length; i += EMAIL_BATCH_SIZE) {
        const batch = subscribers.slice(i, i + EMAIL_BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map(s => sendEmail({
            to: s.email,
            subject,
            html: quizOpenedEmail(quizSnapshot.title, buildUnsubscribeUrl(s.id, 'quiznotify')),
          }))
        )
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            sentIds.push(batch[idx].id)
            sent++
          } else {
            failed++
          }
        })
      }

      // Stem kun IDer der sendingen faktisk lyktes. Feilede rader forblir
      // ustemplate og vil plukkes opp av neste kjøring hvis dedup-sjekken
      // ikke allerede blokkerer (eksisterende begrensning).
      if (sentIds.length > 0) {
        await supabaseAdmin
          .from('quiz_notifications')
          .update({ notified_at: now.toISOString(), notified_quiz_id: quizSnapshot.id })
          .in('id', sentIds)
      }

      console.log(`[cron/notify-subscribers] quiz="${quizSnapshot.title}" sent=${sent} failed=${failed}`)
    })()
  )

  return NextResponse.json({ ok: true })
}
