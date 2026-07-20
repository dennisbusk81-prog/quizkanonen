import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { codePremiumEndedEmail } from '@/lib/email-templates'

// GET /api/cron/expire-code-premium — kjøres daglig.
// Avslutter Premium for brukere som fikk tilgang via en verdikode med begrenset
// varighet, når premium_expires_at har passert. Beskyttet med CRON_SECRET (samme
// mønster som de andre cron-rutene). Schedulering legges til manuelt av Dennis.
//
// Filteret er bevisst smalt: kun premium_source = 'code' og uten eget Stripe-
// abonnement. En bruker som senere kjøper Premium selv får premium_source
// 'personal'/'org' og faller dermed ut av spørringen, selv om en gammel
// premium_expires_at fortsatt skulle ligge igjen på raden.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()

  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('premium_status', true)
    .eq('premium_source', 'code')
    .is('personal_stripe_subscription_id', null)
    .not('premium_expires_at', 'is', null)
    .lt('premium_expires_at', nowIso)

  if (error) {
    console.error('[cron/expire-code-premium] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ expired: 0, sent: 0, reason: 'no code premium to expire' })
  }

  const ids = profiles.map(p => p.id)

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ premium_status: false, premium_source: null, premium_expires_at: null })
    .in('id', ids)

  if (updateError) {
    console.error('[cron/expire-code-premium] update error:', updateError.message)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Avslutnings-e-post (fire-and-forget per bruker)
  const html = codePremiumEndedEmail()
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
      console.error('[cron/expire-code-premium] sendEmail feil for', id, err)
    }
  }

  return NextResponse.json({ expired: ids.length, sent })
}
