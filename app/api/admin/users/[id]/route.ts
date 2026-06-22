import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import Stripe from 'stripe'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Cancel Stripe subscription if any
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', id)
    .maybeSingle()

  if (profile?.stripe_customer_id) {
    try {
      const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: 'active' })
      await Promise.all(subs.data.map(s => stripe.subscriptions.cancel(s.id)))
    } catch (err) {
      console.error('[admin/users DELETE] Stripe cancel failed:', err)
    }
  }

  // Cascade delete related data
  await supabaseAdmin.from('rivalries').delete().or(`challenger_id.eq.${id},rival_id.eq.${id}`)
  await supabaseAdmin.from('league_members').delete().eq('user_id', id)
  await supabaseAdmin.from('season_scores').delete().eq('user_id', id)
  await supabaseAdmin.from('organization_members').delete().eq('user_id', id)

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
  if (error) {
    console.error('[admin/users DELETE] deleteUser failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
