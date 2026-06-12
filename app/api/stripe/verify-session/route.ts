import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Verifiserer en checkout-session direkte mot Stripe så success-siden ikke er
// avhengig av at webhooken har rukket å sette premium_status i DB.
export async function GET(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })

  const sessionId = request.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ paid: false, error: 'Mangler session_id' }, { status: 400 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ paid: false }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ paid: false }, { status: 401 })
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    // Sesjonen må tilhøre den innloggede brukeren
    if (session.metadata?.userId && session.metadata.userId !== user.id) {
      return NextResponse.json({ paid: false }, { status: 403 })
    }

    return NextResponse.json({ paid: session.payment_status === 'paid' })
  } catch (err) {
    console.error('[verify-session] retrieve failed:', err)
    return NextResponse.json({ paid: false, error: 'Noe gikk galt' }, { status: 500 })
  }
}
