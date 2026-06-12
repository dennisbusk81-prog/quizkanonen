import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Rydder opp foreldreløse organisasjoner: org-raden opprettes FØR Stripe-betaling,
// så avbrutt checkout etterlater en org uten stripe_subscription_id. Sletter slike
// orger (+ medlemmer og invitasjoner) når de er eldre enn 1 time.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data: orphans, error: selectError } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .is('stripe_subscription_id', null)
    .lt('created_at', cutoff)

  if (selectError) {
    console.error('[cron/cleanup-orgs] select error:', selectError.message)
    return NextResponse.json({ error: selectError.message }, { status: 500 })
  }

  if (!orphans || orphans.length === 0) {
    return NextResponse.json({ deleted: 0 })
  }

  const orgIds = orphans.map(o => o.id)

  // Slett barn-rader først (i tilfelle FK uten cascade), deretter selve orgene.
  await supabaseAdmin.from('organization_invites').delete().in('organization_id', orgIds)
  await supabaseAdmin.from('organization_members').delete().in('organization_id', orgIds)
  const { error: deleteError } = await supabaseAdmin.from('organizations').delete().in('id', orgIds)

  if (deleteError) {
    console.error('[cron/cleanup-orgs] delete error:', deleteError.message)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: orgIds.length })
}
