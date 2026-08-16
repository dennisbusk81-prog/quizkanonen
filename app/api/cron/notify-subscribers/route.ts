import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { fetchAllRows } from '@/lib/paginate'
import { quizOpenedEmail } from '@/lib/email-templates'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe'
import { dispatchInBatches } from '@/lib/notify-dispatch'
import { findOpenedQuizToNotify } from '@/lib/opened-quiz-lookup'

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

// Vinduet (60 min) og de tre guardene — is_test, is_active og «har quizen
// spørsmål i det hele tatt» — eies av lib/opened-quiz-lookup.ts, delt med
// send-reminders og send-push.
//
// Prisen på det brede vinduet er at en mottaker som feiler HARDT (ugyldig
// adresse) forsøkes på nytt hver kjøring i inntil en time. Det er bevisst:
// alternativet er å stemple feilede sendinger, og det ville gjenåpne hullet
// som 17946e3 lukket — en forbigående Resend-feil ville da permanent frata
// mottakeren e-posten.

type Subscriber = { id: string; email: string }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Oppslag + guards i lib/opened-quiz-lookup.ts. Her lå tidligere en egen kopi
  // av selectet, og kopiene drev fra hverandre: is_test/is_active kom inn i
  // søsterrutene i 28d74c9, mens denne beholdt hullet og annonserte
  // «[TEST – ikke ekte] …» til påmeldingslisten 5. august (7c81c0a).
  //
  // Feilen ble dessuten svelget: oppslaget leste kun `data`, så en DB-feil så ut
  // som «ingen quiz åpnet i vinduet». Nå svarer ruten 500 på feil.
  const lookup = await findOpenedQuizToNotify('cron/notify-subscribers')

  if (lookup.status === 'error') {
    return NextResponse.json({ error: lookup.message }, { status: 500 })
  }
  if (lookup.status === 'empty') {
    // Egen tekst, ikke «ingen quiz i vinduet»: den meldingen er normaltilstanden
    // nesten hele tiden, og å gjemme en tilbakeholdt varsling bak den ville
    // gjort funnet usynlig i loggen. Alt rapportert til Sentry av vakten.
    return NextResponse.json({
      skipped: true,
      reason: 'Quizen som åpnet har ingen spørsmål — varsling holdt tilbake',
      quizId: lookup.quizId,
    })
  }
  if (lookup.status === 'none') {
    return NextResponse.json({ skipped: true, reason: 'Ingen quiz åpnet i vinduet' })
  }

  const quizSnapshot = lookup.quiz

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
