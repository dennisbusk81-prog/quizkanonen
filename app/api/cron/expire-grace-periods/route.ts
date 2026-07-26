import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { gracePeriodEndedEmail } from '@/lib/email-templates'
import { syncPremiumCache } from '@/lib/premium-state-io'

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

  // Profiler der grace har utløpt og som fortsatt er markert Premium.
  // `personal_stripe_subscription_id IS NULL` er FJERNET som vakt: kolonnen ble
  // kun satt av Founders-flyten, så en vanlig betalende B2C-kunde passerte den.
  // Hver kandidat rekalkuleres mot alle kilder under i stedet.
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('premium_status', true)
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

  // Nullstill grace-stempelet, og rekalkuler Premium per bruker i stedet for å
  // slå det av blindt: en verdikode eller et eget abonnement skal overleve at
  // org-grace-perioden løper ut.
  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ org_premium_grace_until: null })
    .in('id', ids)

  if (updateError) {
    console.error('[cron/expire-grace-periods] update error:', updateError.message)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const lostPremium: string[] = []
  let keptViaOtherSource = 0
  for (const id of ids) {
    try {
      const state = await syncPremiumCache(id)
      if (state.isPremium) keptViaOtherSource++
      else lostPremium.push(id)
    } catch (err) {
      console.error('[cron/expire-grace-periods] hoppet over', id, '— kunne ikke avgjøre tilstand:', err)
    }
  }

  // Send avslutnings-e-post (fire-and-forget per bruker) — kun til dem som
  // faktisk mistet tilgangen.
  const html = gracePeriodEndedEmail()
  const subject = 'Premium-tilgangen din er avsluttet'
  let sent = 0
  for (const id of lostPremium) {
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

  return NextResponse.json({ expired: lostPremium.length, keptViaOtherSource, sent })
}
