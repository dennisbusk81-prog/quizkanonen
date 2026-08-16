import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { quizReminderEmail, orgCloseReminderEmail } from '@/lib/email-templates'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe'
import { osloDateString, osloWallClockToUtcIso } from '@/lib/oslo-time'
import { fetchAllRows, fetchAllRowsChunked } from '@/lib/paginate'
import { dispatchInBatches } from '@/lib/notify-dispatch'
import { findOpenedQuizToNotify, quizHasQuestions } from '@/lib/opened-quiz-lookup'
import { detectNotifyDeadZone } from '@/lib/notify-dead-zone'
import {
  NOTIFY_CHANNEL,
  fetchAlreadyNotified,
  stampNotified,
} from '@/lib/quiz-notification-log'

export const maxDuration = 60

// Vi slutter å starte nye batcher etter 50 s, ti sekunder før budsjettet, så
// siste batch rekker å bli stemplet. Se lib/notify-dispatch.ts.
const WORK_BUDGET_MS = 50_000

// Resend avviser over 10 forespørsler i sekundet. EMAIL_BATCH_SIZE (8)
// begrenser SAMTIDIGHET, ikke gjennomstrømning — uten pacing mellom
// batch-startene blir vedvarende rate ~32/s. Se lib/email-batch.ts.
const BATCH_INTERVAL_MS = 1_000

// Vinduet (60 min) og guardene — is_test, is_active og «har quizen spørsmål» —
// eies av lib/opened-quiz-lookup.ts, delt med notify-subscribers og send-push.

type EmailTarget = { userId: string; email: string }

/**
 * Slår opp e-postadresser for et sett med bruker-id-er.
 *
 * `auth.admin.listUsers` er en full skanning uansett hvor få vi spør om, så
 * dette kalles ETTER at alt varslede er trukket fra — er det ingen igjen,
 * unngår vi skanningen helt.
 */
async function resolveEmails(
  userIds: Set<string>,
  logPrefix: string,
): Promise<EmailTarget[]> {
  const targets: EmailTarget[] = []
  let page = 1
  for (;;) {
    const { data: authData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (listError) {
      console.error(`${logPrefix} listUsers error (page`, page, '):', listError.message)
      break
    }
    const users = authData?.users ?? []
    for (const u of users) {
      if (u.email && userIds.has(u.id)) targets.push({ userId: u.id, email: u.email })
    }
    if (users.length < 1000) break
    page++
  }
  return targets
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()

  // Finn en quiz som nettopp åpnet. E-posten sendes NÅR quizen er åpen — ikke
  // en time før. Oppslaget bor i lib/opened-quiz-lookup.ts.
  //
  // MERK: her sto tidligere `.is('reminder_sent_at', null)`. Det filteret var
  // alt-eller-intet-sjekken, og det kan ikke bli stående sammen med stempling
  // per mottaker: en avbrutt kjøring stempler quizen, quizen forsvinner fra
  // DETTE oppslaget, og de gjenstående får aldri e-posten. Vi ville byttet
  // dobbeltsending mot stille undersending — og verre her enn i
  // notify-subscribers, fordi ruten da rapporterer «ingen quiz i vinduet»,
  // som er den normale meldingen nesten hele tiden.
  //
  // Dedupen ligger nå i quiz_notification_log, per mottaker.
  const lookup = await findOpenedQuizToNotify('cron/send-reminders', now)

  // Dødsone-deteksjon — leser og rapporterer, sender aldri. Sjekker ALLE
  // kanaler, ikke bare e-post, slik at denne ruten kan oppdage at push-rutens
  // cron-jobb står stille. Se lib/notify-dead-zone.ts.
  waitUntil(detectNotifyDeadZone('cron/send-reminders', now))

  if (lookup.status === 'error') {
    return NextResponse.json({ error: lookup.message }, { status: 500 })
  }

  // `empty` faller gjennom til org-seksjonen under, som er uavhengig og har sin
  // egen innholdssjekk. Quiz-påminnelsen er allerede holdt tilbake og
  // rapportert av vakten.
  const nextQuiz = lookup.status === 'found' ? lookup.quiz : null

  // Quiz-påminnelser kjøres kun når en quiz nettopp åpnet. Org-close-
  // påminnelsene lenger ned er en egen, uavhengig seksjon som skal kjøre
  // hver gang cronen fyrer — derfor ingen tidlig return her.
  if (nextQuiz) {
    // Tungt arbeid (profiloppslag, auth-paginering, sending) i bakgrunnen via
    // waitUntil, så cron-job.org aldri ser en timeout. maxDuration gjelder
    // også dette arbeidet — det er nettopp her løkken ligger.
    const quizSnapshot = nextQuiz
    const target = { quizId: quizSnapshot.id, channel: NOTIFY_CHANNEL.quizOpenEmail }

    waitUntil(
      (async () => {
        // Abonnentene utledes av et filter og har ingen egen tilstand — derfor
        // paginert henting, ellers ville abonnent nr. 1001 stille aldri fått
        // e-post.
        let profiles: { id: string }[]
        try {
          profiles = await fetchAllRows<{ id: string }>((from, to) =>
            supabaseAdmin
              .from('profiles')
              .select('id')
              .eq('email_reminders', true)
              .order('id', { ascending: true })
              .range(from, to)
          )
        } catch (e) {
          console.error('[cron/send-reminders] profiles error:', e instanceof Error ? e.message : e)
          return
        }

        if (profiles.length === 0) {
          console.log('[cron/send-reminders] no subscribers — nothing to send')
          return
        }

        // Dette er det som gjør kjøringen gjenopptakbar: en avbrutt kjøring
        // etterlater restene, og neste kjøring henter nøyaktig dem.
        let alreadyNotified: Set<string>
        try {
          alreadyNotified = await fetchAlreadyNotified(target)
        } catch (e) {
          // Uten loggen vet vi ikke hvem som alt har fått e-posten. Å sende
          // «for sikkerhets skyld» ville gitt duplikater til hele listen.
          console.error('[cron/send-reminders] kunne ikke lese varslingslogg — sender ingenting:', e instanceof Error ? e.message : e)
          return
        }

        const pendingIds = new Set(profiles.map(p => p.id).filter(id => !alreadyNotified.has(id)))
        if (pendingIds.size === 0) {
          console.log('[cron/send-reminders] alle abonnenter er alt varslet for denne quizen')
          return
        }

        const entriesToSend = await resolveEmails(pendingIds, '[cron/send-reminders]')
        if (entriesToSend.length === 0) {
          console.log('[cron/send-reminders] no subscriber emails found')
          return
        }

        const subject = 'Fredagsquizen er nå åpen'

        const result = await dispatchInBatches<EmailTarget>(
          entriesToSend,
          {
            send: ({ userId, email }) => sendEmail({
              to: email,
              subject,
              html: quizReminderEmail(
                quizSnapshot.id,
                quizSnapshot.closes_at ?? null,
                quizSnapshot.title ?? undefined,
                buildUnsubscribeUrl(userId, 'reminders'),
              ),
            }),
            // Stempler KUN de som faktisk ble levert, og gjør det per batch.
            // Feilede mottakere forblir ustemplet og forsøkes på nytt så lenge
            // quizen er innenfor vinduet.
            stamp: delivered => stampNotified(target, delivered.map(d => d.userId)),
            now: () => Date.now(),
            sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
            onSendError: ({ userId }, reason) => {
              console.error('[cron/send-reminders] sending feilet for bruker', userId, '—', reason)
            },
            onStampError: reason => {
              console.error('[cron/send-reminders] stempling feilet, stopper kjøringen:', reason)
            },
          },
          { batchSize: EMAIL_BATCH_SIZE, minBatchIntervalMs: BATCH_INTERVAL_MS, budgetMs: WORK_BUDGET_MS },
        )

        console.log(
          `[cron/send-reminders] quiz="${quizSnapshot.title}" sendt=${result.sent} ` +
          `feilet=${result.failed} gjenstår=${result.remaining} batcher=${result.batches}` +
          (result.stoppedOnBudget ? ' (stoppet på tidsbudsjett — resten tas ved neste kjøring)' : '') +
          (result.stampFailed ? ' (STOPPET: stempling feilet)' : '')
        )
      })()
    )
  }

  // ── Org close reminders ───────────────────────────────────────────────────
  // Find active quiz (opens_at <= now <= closes_at) for org close time calc.
  //
  // is_test/is_active-guardene er de samme som quiz-påminnelsen over bruker:
  // uten dem plukket denne grenen første åpne quiz sortert på closes_at ASC,
  // uansett om det var en ekte quiz, en testquiz eller en som var skjult i
  // admin («Skjul»-knappen setter is_active=false, og RLS gjemmer den for
  // publikum). En testquiz som lå åpen samtidig som en ekte quiz ville
  // dessuten VINNE sorteringen hvis den stengte først.
  const { data: activeQuiz, error: activeQuizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, closes_at')
    .eq('is_test', false)
    .eq('is_active', true)
    .lte('opens_at', new Date(now).toISOString())
    .gte('closes_at', new Date(now).toISOString())
    .order('closes_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (activeQuizError) {
    console.error('[cron/send-reminders] active quiz lookup error:', activeQuizError.message)
  }

  // Innholdssjekken må gjentas HER, ikke arves fra oppslaget over: org-grenen
  // finner quizen sin med en annen spørring (aktiv nå, sortert på closes_at),
  // så `findOpenedQuizToNotify` har aldri sett denne raden. Samme hendelse,
  // annen kodesti — å rette bare det ene stedet ville etterlatt et hull som ser
  // lukket ut i rapporten.
  //
  // `quizHasQuestions` feiler åpent (se lib/opened-quiz-lookup.ts), så en
  // DB-feil her stopper ikke «en time igjen»-påminnelsen.
  const activeQuizPlayable = activeQuiz
    ? await quizHasQuestions(activeQuiz.id, 'cron/send-reminders org-close')
    : false

  if (activeQuiz && activeQuizPlayable) {
    // Orgene med egen stengetid. `org_close_reminder_quiz_id` leses IKKE
    // lenger: det var et alt-eller-intet-stempel per org, med nøyaktig samme
    // feilform som quiz-stempelet over — ble sendingen avbrutt midt i en
    // organisasjon, fikk resten av medlemmene aldri påminnelsen. Dedupen
    // ligger nå i quiz_notification_log, per medlem, med organisasjonen som
    // scope.
    const { data: orgsWithCloseTime, error: orgsError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, org_quiz_closes_at')
      .not('org_quiz_closes_at', 'is', null)

    if (orgsError) {
      console.error('[cron/send-reminders] orgs lookup error:', orgsError.message)
    }

    // Datoen org-tiden hører til er quizens stengedato slik den ser ut i NORGE
    // — ikke i UTC. Fredagsquizen stenger 20:00Z (22:00 norsk tid), så de to
    // datoene er like i praksis i dag, men de faller fra hverandre så snart en
    // quiz stenger etter norsk midnatt.
    const quizDate = osloDateString(activeQuiz.closes_at)
    const quizOpensMs  = new Date(activeQuiz.opens_at).getTime()
    const quizClosesMs = new Date(activeQuiz.closes_at).getTime()
    if (!quizDate) {
      console.error('[cron/send-reminders] ugyldig closes_at på aktiv quiz:', activeQuiz.id)
    }

    for (const org of (quizDate ? (orgsWithCloseTime ?? []) : []) as { id: string; name: string; org_quiz_closes_at: string }[]) {
      // org_quiz_closes_at er en PostgreSQL TIME-kolonne → "HH:MM:SS" fra
      // PostgREST, og verdien er en NORSK veggklokke (satt i et
      // <input type="time"> i org-admin). Den ble tidligere limt sammen som
      // `${dato}T${tid}.000Z`, altså tolket som UTC — "15:00" ble reelt
      // 17:00 norsk tid om sommeren. Se lib/oslo-time.ts.
      const orgCloseDatetime = osloWallClockToUtcIso(quizDate!, org.org_quiz_closes_at)
      if (!orgCloseDatetime) {
        console.error('[cron/send-reminders] ugyldig org_quiz_closes_at for org', org.id, '—', org.org_quiz_closes_at)
        continue
      }

      // En org-stengetid utenfor quizens eget vindu er meningsløs (og kan
      // oppstå hvis quizen går over et døgnskille). Da skal det ikke sendes.
      const orgCloseMs = new Date(orgCloseDatetime).getTime()
      if (orgCloseMs < quizOpensMs || orgCloseMs > quizClosesMs) continue

      const minUntilClose = (orgCloseMs - now) / 60_000

      // Vinduet er BEVISST ikke utvidet slik quiz-vinduet ble: e-posten lover
      // «en time igjen», så den er bundet til klokkeslettet og ikke bare til
      // quizen. Med cron hvert 5. minutt gir 55–65 min rom for et par
      // kjøringer, og en avbrutt kjøring plukkes opp av den neste innenfor
      // vinduet. Rekker den ikke det, uteblir påminnelsen for restene — det
      // er prisen for at et forsinket «en time igjen» er verdiløst.
      if (minUntilClose < 55 || minUntilClose > 65) continue

      const orgId = org.id
      const orgName = org.name
      const orgClosesAt = orgCloseDatetime
      const orgTarget = {
        quizId: activeQuiz.id,
        channel: NOTIFY_CHANNEL.orgCloseEmail,
        scopeId: orgId,
      }

      waitUntil(
        (async () => {
          // Get org member user IDs
          const { data: memberRows, error: memberError } = await supabaseAdmin
            .from('organization_members')
            .select('user_id')
            .eq('organization_id', orgId)

          if (memberError) {
            console.error('[cron/send-reminders] org members lookup error:', memberError.message)
            return
          }
          if (!memberRows || memberRows.length === 0) return
          const memberUserIds = memberRows.map(m => m.user_id as string)

          // Chunket: `.in()` legger hver id i URL-en og brekker rundt 390
          // id-er — en LAVERE grense enn radtaket på 1000, altså den vi
          // treffer først. Se lib/paginate.ts.
          let subscribedProfiles: { id: string }[]
          try {
            subscribedProfiles = await fetchAllRowsChunked<{ id: string }>(
              memberUserIds,
              (chunk, from, to) =>
                supabaseAdmin
                  .from('profiles')
                  .select('id')
                  .eq('email_reminders', true)
                  .in('id', chunk)
                  .order('id', { ascending: true })
                  .range(from, to)
            )
          } catch (e) {
            console.error('[cron/send-reminders] org subscribed profiles error:', e instanceof Error ? e.message : e)
            return
          }
          if (subscribedProfiles.length === 0) return

          let alreadyNotified: Set<string>
          try {
            alreadyNotified = await fetchAlreadyNotified(orgTarget)
          } catch (e) {
            console.error('[cron/send-reminders] kunne ikke lese varslingslogg for org', orgId, '— sender ingenting:', e instanceof Error ? e.message : e)
            return
          }

          const pendingIds = new Set(
            subscribedProfiles.map(p => p.id).filter(id => !alreadyNotified.has(id))
          )
          if (pendingIds.size === 0) return

          const targets = await resolveEmails(pendingIds, '[cron/send-reminders] org')
          if (targets.length === 0) return

          const html = orgCloseReminderEmail(orgName, orgClosesAt, activeQuiz.title ?? undefined)
          const subject = `Fristen nærmer seg — en time igjen for ${orgName}`

          const result = await dispatchInBatches<EmailTarget>(
            targets,
            {
              send: ({ email }) => sendEmail({ to: email, subject, html }),
              stamp: delivered => stampNotified(orgTarget, delivered.map(d => d.userId)),
              now: () => Date.now(),
              sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
              onSendError: ({ userId }, reason) => {
                console.error('[cron/send-reminders] org-sending feilet for bruker', userId, '—', reason)
              },
              onStampError: reason => {
                console.error('[cron/send-reminders] org-stempling feilet, stopper kjøringen:', reason)
              },
            },
            { batchSize: EMAIL_BATCH_SIZE, minBatchIntervalMs: BATCH_INTERVAL_MS, budgetMs: WORK_BUDGET_MS },
          )

          console.log(
            `[cron/send-reminders] org close reminder: org="${orgName}" sendt=${result.sent} ` +
            `feilet=${result.failed} gjenstår=${result.remaining}` +
            (result.stoppedOnBudget ? ' (stoppet på tidsbudsjett)' : '') +
            (result.stampFailed ? ' (STOPPET: stempling feilet)' : '')
          )
        })()
      )
    }
  }

  return NextResponse.json({ ok: true })
}
