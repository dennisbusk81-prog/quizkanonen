import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { weeklyReportEmail } from '@/lib/email-templates'
import { computeWeeklySummary, buildWeeklyShareText } from '@/lib/weekly-report'

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

// E-post til org-admin (samme mønster som Stripe-webhooken).
async function getOrgAdminEmail(orgId: string): Promise<string | null> {
  const { data: adminMember } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'admin')
    .maybeSingle()
  if (!adminMember) return null
  const { data } = await supabaseAdmin.auth.admin.getUserById(adminMember.user_id)
  return data.user?.email ?? null
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
      timeMatches = true // avgjøres mot quiz-stengetid nedenfor
    }
    if (!timeMatches) continue

    try {
      const summary = await computeWeeklySummary(org.id)
      if (!summary) continue

      // For after_quiz: send kun når quizen har stengt og vi ikke alt har sendt for den.
      if (timing === 'after_quiz') {
        const closesAt = new Date(summary.closesAt)
        if (closesAt > now) continue
        if (sentAt && sentAt >= closesAt) continue
      }

      const email = await getOrgAdminEmail(org.id)
      if (!email) continue

      const shareText = buildWeeklyShareText(summary)
      await sendEmail({
        to: email,
        subject: `Ukens quiz-oppsummering — ${org.name}`,
        from: 'Quizkanonen <support@quizkanonen.no>',
        html: weeklyReportEmail({
          orgName: org.name,
          winner: summary.winner,
          top3: summary.top3,
          participantCount: summary.participantCount,
          shareText,
        }),
      })

      await supabaseAdmin
        .from('organizations')
        .update({ weekly_report_sent_at: now.toISOString() })
        .eq('id', org.id)

      sent++
    } catch (err) {
      errors.push(`${org.id}: ${err instanceof Error ? err.message : 'ukjent feil'}`)
    }
  }

  return NextResponse.json({ ok: true, sent, errors })
}
