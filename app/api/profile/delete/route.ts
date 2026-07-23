import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

export async function DELETE(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = rateLimit(`profile-delete:${ip}`, 5, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
  }

  // Cancel any active Stripe subscriptions — non-fatal if it fails
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.stripe_customer_id) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'active',
      })
      await Promise.all(subscriptions.data.map(sub => stripe.subscriptions.cancel(sub.id)))
    } catch (err) {
      console.error('[profile/delete] Stripe cancellation failed for', user.id, err)
    }
  }

  // Explicit cascade — remove user data from tables without FK cascade to auth.users
  await supabaseAdmin.from('rivalries').delete().or(`challenger_id.eq.${user.id},rival_id.eq.${user.id}`)
  await supabaseAdmin.from('league_members').delete().eq('user_id', user.id)
  await supabaseAdmin.from('season_scores').delete().eq('user_id', user.id)
  await supabaseAdmin.from('organization_members').delete().eq('user_id', user.id)

  // Quiz-historikk: attempts har INGEN FK til auth.users, så deleteUser rører den
  // ikke. Uten dette ble all spillehistorikk (attempts + attempt_answers) stående
  // for alltid med en user_id som pekte på en slettet bruker — brudd på GDPR
  // art. 17. attempt_answers.attempt_id → attempts.id, så barna slettes FØR
  // foreldrene (samme rekkefølge som admin sin quiz-reset).
  const { data: userAttempts } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('user_id', user.id)
  const attemptIds = (userAttempts ?? []).map(a => a.id)
  if (attemptIds.length > 0) {
    await supabaseAdmin.from('attempt_answers').delete().in('attempt_id', attemptIds)
    await supabaseAdmin.from('attempts').delete().eq('user_id', user.id)
  }

  // Delete user — RLS CASCADE removes the profiles row automatically
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[profile/delete] deleteUser failed:', deleteError.message)
    return NextResponse.json({ error: 'Kunne ikke slette kontoen. Prøv igjen.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
