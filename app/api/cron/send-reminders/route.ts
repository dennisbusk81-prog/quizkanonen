import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { quizReminderEmail, orgCloseReminderEmail } from '@/lib/email-templates'
import { buildUnsubscribeUrl } from '@/lib/unsubscribe'
import { osloDateString, osloWallClockToUtcIso } from '@/lib/oslo-time'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()

  // Find a quiz that just opened (opens_at within the last 0–10 minutes).
  // E-posten sendes NÅR quizen er åpen — ikke en time før. reminder_sent_at IS NULL
  // hindrer dobbel-sending hvis cron-en kjører flere ganger i vinduet.
  //
  // Vinduet var 5 minutter fram til 31. juli 2026 — nøyaktig samme lengde som
  // cronens egen kadens, altså kant-i-kant uten margin. cron-job.org fyrer ikke
  // på sekundet, så en quiz som åpnet i sprekken mellom to kjøringer fikk ALDRI
  // åpningse-posten, og feilet stille: `reminder_sent_at` ble stående NULL, men
  // `opens_at`-filteret hadde allerede passert, så ingen senere kjøring plukket
  // den opp igjen. Ingen feilmelding noe sted — bare en utsendelse som uteble.
  // 10 minutter gir én hel kjøring i margin og er samme vindu som
  // send-push og notify-subscribers allerede bruker. Å utvide er trygt nettopp
  // fordi reminder_sent_at IS NULL hindrer dobbeltsending i det bredere vinduet.
  const windowStart = new Date(now - 10 * 60 * 1000).toISOString()
  const nowIso      = new Date(now).toISOString()

  const { data: nextQuiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, closes_at, reminder_sent_at')
    .eq('is_test', false)
    .eq('is_active', true)
    .lte('opens_at', nowIso)
    .gte('opens_at', windowStart)
    .is('reminder_sent_at', null)
    .order('opens_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (quizError) {
    console.error('[cron/send-reminders] quiz lookup error:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 500 })
  }

  // Quiz-påminnelser kjøres kun når en quiz nettopp åpnet. Org-close-
  // påminnelsene lenger ned er en egen, uavhengig seksjon som skal kjøre
  // hver gang cronen fyrer — derfor ingen tidlig return her lenger.
  if (nextQuiz) {
    // A quiz is in the reminder window — do the heavy lifting (profile
    // lookup, auth pagination, email sending) in the background via
    // waitUntil so cron-job.org never sees a timeout.
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

      const entriesToSend = [...emailsByUserId.entries()]
      if (entriesToSend.length === 0) {
        console.log('[cron/send-reminders] no subscriber emails found')
        return
      }

      const subject = 'Fredagsquizen er nå åpen'
      let sent = 0
      let failed = 0

      // Send i batcher av samtidige e-poster — se EMAIL_BATCH_SIZE i lib/email-batch.ts
      for (let i = 0; i < entriesToSend.length; i += EMAIL_BATCH_SIZE) {
        const batch = entriesToSend.slice(i, i + EMAIL_BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map(([userId, email]) => {
            const html = quizReminderEmail(quizSnapshot.id, quizSnapshot.closes_at ?? null, quizSnapshot.title ?? undefined, buildUnsubscribeUrl(userId, 'reminders'))
            return sendEmail({ to: email, subject, html })
          })
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
  }

  // ── Org close reminders ───────────────────────────────────────────────────
  // Find active quiz (opens_at <= now <= closes_at) for org close time calc.
  //
  // is_test/is_active-guardene er de samme som quiz-påminnelsen over bruker:
  // uten dem plukket denne grenen første åpne quiz sortert på closes_at ASC,
  // uansett om det var en ekte quiz, en testquiz eller en som var skjult i
  // admin («Skjul»-knappen setter is_active=false, og RLS gjemmer den for
  // publikum). En testquiz som lå åpen samtidig som en ekte quiz ville
  // dessuten VINNE sorteringen hvis den stengte først — og da ville
  // org_close_reminder_quiz_id blitt stemplet på testquizen, slik at den ekte
  // quizens påminnelse aldri ble sendt.
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

  if (activeQuiz) {
    // Find orgs with org_quiz_closes_at set, not already reminded for this quiz
    const { data: orgsWithCloseTime, error: orgsError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, org_quiz_closes_at, org_close_reminder_quiz_id')
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

    for (const org of (quizDate ? (orgsWithCloseTime ?? []) : []) as { id: string; name: string; org_quiz_closes_at: string; org_close_reminder_quiz_id: string | null }[]) {
      if (org.org_close_reminder_quiz_id === activeQuiz.id) continue // already sent for this quiz

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

      if (minUntilClose < 55 || minUntilClose > 65) continue // not in window

      const orgId = org.id
      const orgName = org.name
      const orgClosesAt = orgCloseDatetime

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
          const memberUserIds = new Set(memberRows.map(m => m.user_id))

          // Find members who have email_reminders enabled
          const { data: subscribedProfiles, error: subsError } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email_reminders', true)
            .in('id', [...memberUserIds])

          if (subsError) {
            console.error('[cron/send-reminders] org subscribed profiles error:', subsError.message)
            return
          }
          if (!subscribedProfiles || subscribedProfiles.length === 0) return
          const subscribedIds = new Set(subscribedProfiles.map(p => p.id))

          // Resolve emails
          const emailsByUserId = new Map<string, string>()
          let page = 1
          while (true) {
            const { data: authData, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
            if (listError) {
              console.error('[cron/send-reminders] org listUsers error (page', page, '):', listError.message)
              break
            }
            const users = authData?.users ?? []
            for (const u of users) {
              if (u.email && subscribedIds.has(u.id)) emailsByUserId.set(u.id, u.email)
            }
            if (users.length < 1000) break
            page++
          }

          const emails = [...emailsByUserId.values()]
          if (emails.length === 0) return

          const html = orgCloseReminderEmail(orgName, orgClosesAt, activeQuiz.title ?? undefined)
          const subject = `Fristen nærmer seg — en time igjen for ${orgName}`
          let sent = 0
          for (let i = 0; i < emails.length; i += EMAIL_BATCH_SIZE) {
            const batch = emails.slice(i, i + EMAIL_BATCH_SIZE)
            const results = await Promise.allSettled(batch.map(email => sendEmail({ to: email, subject, html })))
            sent += results.filter(r => r.status === 'fulfilled').length
          }

          if (sent > 0) {
            const { error: markError } = await supabaseAdmin
              .from('organizations')
              .update({ org_close_reminder_quiz_id: activeQuiz.id })
              .eq('id', orgId)
            if (markError) {
              console.error('[cron/send-reminders] failed to set org_close_reminder_quiz_id:', markError.message)
            }
          }

          console.log(`[cron/send-reminders] org close reminder: org="${orgName}" sent=${sent}`)
        })()
      )
    }
  }

  return NextResponse.json({ ok: true })
}
