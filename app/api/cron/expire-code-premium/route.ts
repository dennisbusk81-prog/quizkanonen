import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { codePremiumEndedEmail } from '@/lib/email-templates'
import { syncPremiumCache } from '@/lib/premium-state-io'

// GET /api/cron/expire-code-premium — kjøres daglig.
// Avslutter Premium for brukere som fikk tilgang via en verdikode med begrenset
// varighet, når premium_expires_at har passert. Beskyttet med CRON_SECRET (samme
// mønster som de andre cron-rutene). Schedulering legges til manuelt av Dennis.
//
// Filteret er bevisst smalt: kun premium_source = 'code' og uten eget Stripe-
// abonnement. En bruker som senere kjøper Premium selv får premium_source
// 'personal'/'org' og faller dermed ut av spørringen, selv om en gammel
// premium_expires_at fortsatt skulle ligge igjen på raden.
// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()

  // Kandidatene er alle med en utløpt kode-periode. Vakten
  // `personal_stripe_subscription_id IS NULL` er FJERNET her med vilje: den var
  // ment å bety «har ikke eget abonnement», men kolonnen ble kun satt av
  // Founders-flyten, så en vanlig betalende B2C-kunde slapp rett gjennom den.
  // I stedet rekalkuleres hver kandidat mot ALLE kildene under.
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('premium_status', true)
    .eq('premium_source', 'code')
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

  // Rekalkuler hver bruker mot alle kilder i stedet for å slå av Premium blindt.
  // En bruker kan ha et betalt abonnement eller org-medlemskap under koden — de
  // skal beholde Premium uten avbrudd, og skal IKKE ha avslutnings-e-post.
  const lostPremium: string[] = []
  let keptViaOtherSource = 0

  for (const id of ids) {
    try {
      const state = await syncPremiumCache(id)
      if (state.isPremium) keptViaOtherSource++
      else lostPremium.push(id)
    } catch (err) {
      // Kunne ikke avgjøre tilstanden (typisk Stripe nede). Da lar vi brukeren
      // beholde Premium til neste kjøring — å ta den fra en betalende kunde på
      // et usikkert grunnlag er verre enn en dags forsinket utløp.
      console.error('[cron/expire-code-premium] hoppet over', id, '— kunne ikke avgjøre tilstand:', err)
    }
  }

  // Avslutnings-e-post (fire-and-forget per bruker) — kun til dem som faktisk
  // mistet tilgangen.
  const html = codePremiumEndedEmail()
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
      console.error('[cron/expire-code-premium] sendEmail feil for', id, err)
    }
  }

  return NextResponse.json({ expired: lostPremium.length, keptViaOtherSource, sent })
}
