import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import webpush from 'web-push'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  // Find quiz that just opened and hasn't had push sent yet
  const { data: quiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, push_sent_at')
    .lte('opens_at', now)
    .is('push_sent_at', null)
    .order('opens_at', { ascending: false })
    .limit(1)
    .single()

  if (quizError || !quiz) {
    return NextResponse.json({ sent: 0, reason: 'no quiz to notify' })
  }

  // Only notify if quiz opened within the last 10 minutes (same window as email cron)
  const openedAt = new Date(quiz.opens_at)
  const minutesAgo = (Date.now() - openedAt.getTime()) / 60_000
  if (minutesAgo > 10) {
    return NextResponse.json({ sent: 0, reason: 'quiz opened too long ago' })
  }

  const { data: subscriptions, error: subError } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')

  if (subError) {
    console.error('[cron/send-push] fetch subscriptions:', subError.message)
    return NextResponse.json({ error: subError.message }, { status: 500 })
  }

  if (!subscriptions || subscriptions.length === 0) {
    await supabaseAdmin.from('quizzes').update({ push_sent_at: now }).eq('id', quiz.id)
    return NextResponse.json({ sent: 0, reason: 'no subscriptions' })
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:support@quizkanonen.no',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )

  const payload = JSON.stringify({
    title: 'Ukens quiz er klar!',
    body: 'Spill nå på Quizkanonen',
    url: 'https://www.quizkanonen.no',
  })

  let sent = 0
  let failed = 0
  const staleEndpoints: string[] = []

  await Promise.allSettled(
    subscriptions.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        sent++
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 410 || status === 404) {
          staleEndpoints.push(sub.endpoint)
        } else {
          console.error('[cron/send-push] send error:', err)
        }
        failed++
      }
    })
  )

  // Clean up stale/expired subscriptions
  if (staleEndpoints.length > 0) {
    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .in('endpoint', staleEndpoints)
  }

  // Mark quiz as notified
  await supabaseAdmin
    .from('quizzes')
    .update({ push_sent_at: now })
    .eq('id', quiz.id)

  console.log(`[cron/send-push] quiz="${quiz.title}" sent=${sent} failed=${failed} stale=${staleEndpoints.length}`)
  return NextResponse.json({ sent, failed, stale: staleEndpoints.length })
}
