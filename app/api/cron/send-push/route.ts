import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import webpush from 'web-push'
import { fetchAllRows } from '@/lib/paginate'
import { dispatchInBatches } from '@/lib/notify-dispatch'
import {
  NOTIFY_CHANNEL,
  fetchAlreadyNotified,
  stampNotified,
} from '@/lib/quiz-notification-log'

// Ruten hadde INGEN maxDuration og arvet standardbudsjettet, mens
// søsterrutene sto på 60. Budsjettet gjelder også arbeidet inne i waitUntil —
// det er nettopp der løkken ligger.
export const maxDuration = 60

const WORK_BUDGET_MS = 50_000

// Push er ikke Resend: det finnes ingen felles 10/s-grense, og mottakerne er
// spredt på flere leverandører (FCM, Mozilla, Apple). 20 samtidige med 500 ms
// mellom batch-startene gir ~40/s — nok til at en stor liste kommer gjennom
// på et par kjøringer, lavt nok til at vi ikke hamrer én leverandør.
const PUSH_BATCH_SIZE = 20
const BATCH_INTERVAL_MS = 500

// Samme vindu og samme begrunnelse som send-reminders: det gamle
// 10-minutters-vinduet var en kompensasjon for at stemplingen var feil, ikke
// en egen beskyttelse. Ekstra trygt her, fordi en hardt feilende mottaker
// (410/404) slettes og dermed forsvinner av seg selv i stedet for å bli
// forsøkt i en time.
const NOTIFY_WINDOW_MS = 60 * 60 * 1000

type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  const windowStart = new Date(now - NOTIFY_WINDOW_MS).toISOString()

  // Finn en quiz som nettopp åpnet.
  //
  // To ting er endret her:
  //  • `.is('push_sent_at', null)` er FJERNET. Det filteret var
  //    alt-eller-intet-sjekken; sammen med stempling per mottaker ville det
  //    byttet dobbeltsending mot stille undersending. Dedupen ligger nå i
  //    quiz_notification_log, per abonnement.
  //  • `is_test`/`is_active`-guardene er LAGT TIL. Uten dem kunne en testquiz
  //    som åpnet senere enn den ekte vinne `order('opens_at', desc)`, bli
  //    stemplet som varslet, og dermed hindre at den ekte quizens push noen
  //    gang ble sendt — stille. Nøyaktig samme feil som er dokumentert og
  //    rettet i org-grenen i send-reminders.
  //
  // Vinduet ligger i spørringen i stedet for i en etterfølgende JS-sjekk, så
  // en gammel, uvarslet quiz ikke lenger kan legge beslag på oppslaget.
  const { data: quiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at')
    .eq('is_test', false)
    .eq('is_active', true)
    .lte('opens_at', new Date(now).toISOString())
    .gte('opens_at', windowStart)
    .order('opens_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (quizError) {
    console.error('[cron/send-push] quiz lookup error:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 500 })
  }

  if (!quiz) {
    return NextResponse.json({ sent: 0, reason: 'no quiz to notify' })
  }

  const quizSnapshot = quiz
  const target = { quizId: quizSnapshot.id, channel: NOTIFY_CHANNEL.quizOpenPush }

  waitUntil(
    (async () => {
      // Paginert full henting — ellers ville abonnenter over rad 1000 stille
      // aldri fått push-varsling om at ukens quiz er åpen.
      let subscriptions: PushTarget[]
      try {
        subscriptions = await fetchAllRows<PushTarget>((from, to) =>
          supabaseAdmin
            .from('push_subscriptions')
            .select('id, endpoint, p256dh, auth')
            .order('id', { ascending: true })
            .range(from, to)
        )
      } catch (e) {
        console.error('[cron/send-push] fetch subscriptions:', e instanceof Error ? e.message : e)
        return
      }

      if (subscriptions.length === 0) {
        console.log('[cron/send-push] ingen abonnementer')
        return
      }

      // Enheten er ABONNEMENTET, ikke brukeren: én bruker kan ha flere
      // enheter, og feiler bare den ene, skal bare den forsøkes på nytt.
      let alreadyNotified: Set<string>
      try {
        alreadyNotified = await fetchAlreadyNotified(target)
      } catch (e) {
        // Uten loggen vet vi ikke hvem som alt har fått varselet, og å sende
        // «for sikkerhets skyld» ville gitt duplikat-push til hele listen.
        console.error('[cron/send-push] kunne ikke lese varslingslogg — sender ingenting:', e instanceof Error ? e.message : e)
        return
      }

      const pending = subscriptions.filter(s => !alreadyNotified.has(s.id))
      if (pending.length === 0) {
        console.log('[cron/send-push] alle abonnementer er alt varslet for denne quizen')
        return
      }

      // setVapidDetails kaster på manglende/ugyldige nøkler. Inne i try, så et
      // konfigurasjonsavvik gir en logget feil i stedet for en uhåndtert
      // rejection i bakgrunnsjobben.
      try {
        webpush.setVapidDetails(
          process.env.VAPID_SUBJECT ?? 'mailto:support@quizkanonen.no',
          process.env.VAPID_PUBLIC_KEY!,
          process.env.VAPID_PRIVATE_KEY!,
        )
      } catch (e) {
        console.error('[cron/send-push] VAPID-oppsett feilet — ingen push sendt:', e instanceof Error ? e.message : e)
        return
      }

      const payload = JSON.stringify({
        title: 'Ukens quiz er klar!',
        body: 'Spill nå på Quizkanonen',
        url: 'https://www.quizkanonen.no',
      })

      const staleEndpoints: string[] = []

      const result = await dispatchInBatches<PushTarget>(
        pending,
        {
          send: sub => webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          ),
          stamp: delivered => stampNotified(target, delivered.map(d => d.id)),
          now: () => Date.now(),
          sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
          onSendError: (sub, reason) => {
            const status = (reason as { statusCode?: number } | null)?.statusCode
            if (status === 410 || status === 404) {
              staleEndpoints.push(sub.endpoint)
            } else {
              console.error('[cron/send-push] send error:', reason)
            }
          },
          onStampError: reason => {
            console.error('[cron/send-push] stempling feilet, stopper kjøringen:', reason)
          },
        },
        { batchSize: PUSH_BATCH_SIZE, minBatchIntervalMs: BATCH_INTERVAL_MS, budgetMs: WORK_BUDGET_MS },
      )

      // Opprydding, ikke korrekthet: blir kjøringen drept før vi kommer hit,
      // forsøkes de samme døde endepunktene på nytt neste gang og feiler likt.
      // De stemples aldri, så de kan ikke maskere en levende mottaker.
      if (staleEndpoints.length > 0) {
        const { error } = await supabaseAdmin
          .from('push_subscriptions')
          .delete()
          .in('endpoint', staleEndpoints)
        if (error) console.error('[cron/send-push] kunne ikke slette døde abonnementer:', error.message)
      }

      console.log(
        `[cron/send-push] quiz="${quizSnapshot.title}" sendt=${result.sent} ` +
        `feilet=${result.failed} gjenstår=${result.remaining} døde=${staleEndpoints.length}` +
        (result.stoppedOnBudget ? ' (stoppet på tidsbudsjett — resten tas ved neste kjøring)' : '') +
        (result.stampFailed ? ' (STOPPET: stempling feilet)' : '')
      )
    })()
  )

  return NextResponse.json({ ok: true })
}
