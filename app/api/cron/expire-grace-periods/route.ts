import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { gracePeriodEndedEmail } from '@/lib/email-templates'

// GET /api/cron/expire-grace-periods — kjøres daglig.
// Avslutter Premium for brukere der org-grace-perioden har utløpt. Beskyttet med
// CRON_SECRET (samme mønster som de andre cron-rutene). Schedulering legges til
// manuelt av Dennis.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()

  // Profiler der grace har utløpt, fortsatt markert Premium, og uten eget abonnement
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('premium_status', true)
    .is('personal_stripe_subscription_id', null)
    .not('org_premium_grace_until', 'is', null)
    .lt('org_premium_grace_until', nowIso)

  if (error) {
    console.error('[cron/expire-grace-periods] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ expired: 0, sent: 0, reason: 'no grace periods to expire' })
  }

  const ids = profiles.map(p => p.id)

  // Slå av Premium og nullstill grace-stempelet
  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ premium_status: false, premium_source: null, org_premium_grace_until: null })
    .in('id', ids)

  if (updateError) {
    console.error('[cron/expire-grace-periods] update error:', updateError.message)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Send avslutnings-e-post (fire-and-forget per bruker)
  const html = gracePeriodEndedEmail()
  const subject = 'Premium-tilgangen din er avsluttet'
  let sent = 0
  for (const id of ids) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(id)
      if (user?.email) {
        await sendEmail({ to: user.email, subject, html })
        sent++
      }
    } catch (err) {
      console.error('[cron/expire-grace-periods] sendEmail feil for', id, err)
    }
  }

  return NextResponse.json({ expired: ids.length, sent })
}
