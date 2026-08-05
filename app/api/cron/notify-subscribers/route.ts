import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { fetchAllRows } from '@/lib/paginate'
import { quizOpenedEmail } from '@/lib/email-templates'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe'
import { dispatchInBatches } from '@/lib/notify-dispatch'

export const dynamic = 'force-dynamic'

// Uten denne arvet ruten standardbudsjettet, mens søsterrutene send-reminders
// og publish-quiz allerede sto på 60. Budsjettet gjelder også arbeidet inne i
// waitUntil — det er nettopp der løkken ligger.
export const maxDuration = 60

// Vi slutter å starte nye batcher etter 50 s, ti sekunder før budsjettet.
// Marginen finnes for at siste batch skal rekke å bli STEMPLET; blir vi drept
// på 60 uten margin, mister vi alltid stemplingen for batchen som var
// underveis.
const WORK_BUDGET_MS = 50_000

// Resend avviser over 10 forespørsler i sekundet. Med EMAIL_BATCH_SIZE = 8
// samtidige per batch gir ett sekund mellom batch-startene en vedvarende rate
// på ~8/s. EMAIL_BATCH_SIZE alene holder IKKE grensen — se lib/email-batch.ts.
const BATCH_INTERVAL_MS = 1_000

// Hvor lenge etter åpning en quiz fortsatt kan varsles om.
//
// Vinduet var 10 minutter, og var da den ENESTE beskyttelsen mot at noen fikk
// e-posten to ganger: stemplingen skjedde først etter hele løkken, så et
// avbrudd etterlot ingen spor, og et smalt vindu begrenset hvor mange ganger
// det kunne gjenta seg. Nå som hver mottaker stemples fortløpende OG
// abonnenthentingen filtrerer bort de som alt er varslet for denne quizen, er
// gjentatte kjøringer trygge — de plukker opp nøyaktig restene.
//
// Da blir det smale vinduet i stedet en begrensning: med ~400 e-poster per
// kjøring og cron hvert 5. minutt rakk to kjøringer aldri en liste på et par
// tusen. 60 minutter gir ~12 kjøringer, altså rikelig margin for
// annonseringslisten på ~2500.
//
// Prisen er at en mottaker som feiler HARDT (ugyldig adresse) forsøkes på nytt
// hver kjøring i inntil en time i stedet for i ti minutter. Det er bevisst:
// alternativet er å stemple feilede sendinger, og det ville gjenåpne hullet
// som 17946e3 lukket — en forbigående Resend-feil ville da permanent frata
// mottakeren e-posten.
const NOTIFY_WINDOW_MS = 60 * 60 * 1000

type Subscriber = { id: string; email: string }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const windowStart = new Date(now.getTime() - NOTIFY_WINDOW_MS).toISOString()

  // is_test/is_active-guardene: uten dem plukket oppslaget ENHVER quiz-rad som
  // åpnet i vinduet — også en testquiz eller en som var skjult i admin
  // («Skjul» setter is_active=false). Det slo til i prod 5. august 2026: en
  // etterlatt testquiz åpnet 22:46, og kjøringen 23:00 annonserte
  // «[TEST – ikke ekte] finishQuiz-timeout» til påmeldingslisten.
  //
  // Skaden var én e-post fordi listen har én rad i dag. Ved annonsering er
  // den samme feilen et par tusen e-poster om en testquiz — eller om en quiz
  // som bevisst er skjult, noe som er verre.
  //
  // Søsterrutene send-reminders og send-push har hatt de samme to linjene
  // siden 28d74c9. Denne ruten fyrer på nøyaktig samme hendelse (en quiz
  // åpner) og skal ha samme guard.
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at')
    .eq('is_test', false)
    .eq('is_active', true)
    .lte('opens_at', now.toISOString())
    .gte('opens_at', windowStart)
    .order('opens_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!quiz) {
    return NextResponse.json({ skipped: true, reason: 'Ingen quiz åpnet i vinduet' })
  }

  const quizSnapshot = quiz

  // MERK: her lå tidligere en «er denne quizen allerede varslet?»-sjekk som
  // hoppet over hele kjøringen så snart ÉN rad var stemplet med denne
  // quiz-id-en. Den kan ikke bli stående sammen med stempling underveis: en
  // avbrutt kjøring ville stemplet de første mottakerne, og neste kjøring
  // ville da sett «allerede varslet» og hoppet over resten — for godt. Vi
  // ville byttet dobbeltsending mot STILLE UNDERSENDING, som er verre fordi
  // ingenting i loggen viser at noen manglet.
  //
  // Filteret i hentingen under gjør samme jobb, men per mottaker: er alle
  // varslet, kommer listen tom tilbake og kjøringen avsluttes like billig.

  waitUntil(
    (async () => {
      // Hent kun abonnenter som IKKE alt er varslet for nettopp denne quizen.
      // Dette er det som gjør kjøringen gjenopptakbar: en avbrutt kjøring
      // etterlater restene, og neste kjøring henter nøyaktig dem.
      //
      // `.neq` alene ville utelatt radene der notified_quiz_id er NULL —
      // altså alle som aldri har fått noe varsel. Derfor .or() med is.null.
      let subscribers: Subscriber[]
      try {
        subscribers = await fetchAllRows<Subscriber>((from, to) =>
          supabaseAdmin
            .from('quiz_notifications')
            .select('id, email')
            .or(`notified_quiz_id.is.null,notified_quiz_id.neq.${quizSnapshot.id}`)
            .order('id', { ascending: true })
            .range(from, to)
        )
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Kunne ikke hente abonnenter'
        console.error('[cron/notify-subscribers] henting av abonnenter feilet:', message)
        return
      }

      if (subscribers.length === 0) {
        console.log('[cron/notify-subscribers] ingen gjenstående abonnenter å varsle')
        return
      }

      // Malen bygges PER MOTTAKER, ikke én gang for alle: avmeldingslenken er
      // signert med abonnentens egen rad-id, så den kan ikke deles på tvers.
      // Emnefeltet er ren tekst og skal IKKE escapes — der ville `&amp;` blitt
      // stående synlig.
      const subject = `Ukens quiz er klar — ${quizSnapshot.title ?? 'Quizkanonen'}`

      const result = await dispatchInBatches<Subscriber>(
        subscribers,
        {
          send: s => sendEmail({
            to: s.email,
            subject,
            html: quizOpenedEmail(quizSnapshot.title, buildUnsubscribeUrl(s.id, 'quiznotify')),
          }),
          // Stempler KUN de som faktisk ble levert, og gjør det per batch.
          // Feilede rader forblir ustemplet og forsøkes på nytt så lenge
          // quizen er innenfor vinduet.
          stamp: async delivered => {
            const { error } = await supabaseAdmin
              .from('quiz_notifications')
              .update({
                notified_at: new Date().toISOString(),
                notified_quiz_id: quizSnapshot.id,
              })
              .in('id', delivered.map(d => d.id))
            if (error) throw new Error(error.message)
          },
          now: () => Date.now(),
          sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
          onSendError: (s, reason) => {
            console.error('[cron/notify-subscribers] sending feilet for rad', s.id, '—', reason)
          },
          onStampError: reason => {
            console.error('[cron/notify-subscribers] stempling feilet, stopper kjøringen:', reason)
          },
        },
        {
          batchSize: EMAIL_BATCH_SIZE,
          minBatchIntervalMs: BATCH_INTERVAL_MS,
          budgetMs: WORK_BUDGET_MS,
        },
      )

      console.log(
        `[cron/notify-subscribers] quiz="${quizSnapshot.title}" sendt=${result.sent} ` +
        `feilet=${result.failed} gjenstår=${result.remaining} batcher=${result.batches}` +
        (result.stoppedOnBudget ? ' (stoppet på tidsbudsjett — resten tas ved neste kjøring)' : '') +
        (result.stampFailed ? ' (STOPPET: stempling feilet)' : '')
      )
    })()
  )

  return NextResponse.json({ ok: true })
}
