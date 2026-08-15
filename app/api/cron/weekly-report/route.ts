import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { weeklyReportEmail } from '@/lib/email-templates'
import { getOrgAdminEmails, sendToOrgAdmins } from '@/lib/org-admin-emails'
import { computeWeeklySummary, buildWeeklyShareText, getLatestClosedQuiz } from '@/lib/weekly-report'
import type { LatestClosedQuiz } from '@/lib/weekly-report'

export const dynamic = 'force-dynamic'

// Oslo-tid: ukedag (Mon..Sun), time (0-23) og dato-nøkkel (YYYY-MM-DD).
function osloParts(d: Date): { weekday: string; hour: number; dateKey: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    weekday: 'short', hour: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return {
    weekday: get('weekday'),
    hour: parseInt(get('hour'), 10) % 24,
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

// GET /api/cron/weekly-report — kjøres hvert 15. min via cron-job.org.
// Sender ukens oppsummering til Standard-bedrifter basert på valgt tidspunkt.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const { weekday, hour, dateKey } = osloParts(now)

  // Kun Standard-orger med aktivt abonnement.
  const { data: orgs } = await supabaseAdmin
    .from('organizations')
    .select('id, name, weekly_report_timing, weekly_report_sent_at, stripe_subscription_id')
    .eq('plan', 'standard')
    .not('stripe_subscription_id', 'is', null)

  let sent = 0
  const errors: string[] = []

  // «Sist stengte quiz» er global (ikke per org) — hentes derfor maks én gang
  // per kjøring, og kun hvis en after_quiz-org faktisk finnes.
  // undefined = ikke hentet ennå.
  let latestClosed: LatestClosedQuiz | null | undefined

  for (const org of orgs ?? []) {
    const timing = org.weekly_report_timing ?? 'monday_morning'
    const sentAt = org.weekly_report_sent_at ? new Date(org.weekly_report_sent_at) : null

    // Tidspunkt-sjekk før vi gjør tyngre databasearbeid.
    let timeMatches = false
    if (timing === 'saturday_morning') {
      timeMatches = weekday === 'Sat' && hour >= 9 && (!sentAt || osloParts(sentAt).dateKey !== dateKey)
    } else if (timing === 'monday_morning') {
      timeMatches = weekday === 'Mon' && hour >= 8 && (!sentAt || osloParts(sentAt).dateKey !== dateKey)
    } else if (timing === 'after_quiz') {
      // Duplikatvakten ligger HER — før computeWeeklySummary — ikke etter.
      // Tidligere sto den etter beregningen, så en after_quiz-org kjørte hele
      // den tunge beregningen (organization_members + attempts + profiles)
      // hvert 15. minutt hele uken, og kastet nesten alltid resultatet.
      // Samme betingelser som før, bare flyttet: quizen må ha stengt, og vi
      // må ikke allerede ha sendt for den.
      if (latestClosed === undefined) latestClosed = await getLatestClosedQuiz()
      if (latestClosed) {
        const closesAt = new Date(latestClosed.closes_at)
        timeMatches = closesAt <= now && (!sentAt || sentAt < closesAt)
      }
    }
    if (!timeMatches) continue

    try {
      const summary = await computeWeeklySummary(org.id)
      if (!summary) continue

      // Backstop for after_quiz: skulle en quiz stenge mellom vakt-oppslaget
      // over og beregningen, gjelder fortsatt samme regel mot beregningens
      // egen quiz. Primærvakten er timeMatches-grenen — denne er billig og
      // nås kun når en sending faktisk er underveis.
      if (timing === 'after_quiz') {
        const closesAt = new Date(summary.closesAt)
        if (closesAt > now) continue
        if (sentAt && sentAt >= closesAt) continue
      }

      const { emails } = await getOrgAdminEmails(org.id)
      if (emails.length === 0) continue

      // Stemple FØR sending: duplikat-e-post er verre enn tapt e-post.
      // Feiler stemplingen, hopper vi over — cron prøver igjen om 15 min.
      const { error: stampErr } = await supabaseAdmin
        .from('organizations')
        .update({ weekly_report_sent_at: now.toISOString() })
        .eq('id', org.id)

      if (stampErr) {
        console.error('[cron/weekly-report] stamp failed, hopper over org:', org.id, stampErr.message)
        errors.push(`${org.id}: stamp feilet — ${stampErr.message}`)
        continue
      }

      const shareText = buildWeeklyShareText(summary)
      // Alle admins i orgen, ikke bare én vilkårlig valgt.
      const { sent: okCount } = await sendToOrgAdmins(
        emails,
        {
          subject: `Ukens quiz-oppsummering — ${org.name}`,
          from: 'Quizkanonen <support@quizkanonen.no>',
          html: weeklyReportEmail({
            orgName: org.name,
            winner: summary.winner,
            top3: summary.top3,
            participantCount: summary.participantCount,
            shareText,
          }),
        },
        `cron/weekly-report org=${org.id}`,
      )

      if (okCount === 0) {
        errors.push(`${org.id}: ingen av ${emails.length} admin-e-poster gikk gjennom`)
        continue
      }

      sent++
    } catch (err) {
      errors.push(`${org.id}: ${err instanceof Error ? err.message : 'ukjent feil'}`)
    }
  }

  return NextResponse.json({ ok: true, sent, errors })
}
