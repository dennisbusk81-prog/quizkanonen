import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { orgInviteEmail } from '@/lib/email-templates'
import { rateLimit } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // organizationId er UUID her, ikke en slug — kun param-navn er endret for Next.js routing-konsistens
  const { slug: organizationId } = await params

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`send-invite:${ip}`, 5, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // Verify caller is admin of this org
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Ingen admin-tilgang' }, { status: 403 })
  }

  let body: { emails?: unknown; inviteUrl?: unknown; senderName?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { emails, inviteUrl, senderName } = body

  if (!Array.isArray(emails) || typeof inviteUrl !== 'string' || typeof senderName !== 'string') {
    return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 })
  }

  // FIX 9 — validate inviteUrl against our own domain to prevent phishing links in emails
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  if (!siteUrl || !inviteUrl.startsWith(siteUrl)) {
    return NextResponse.json({ error: 'Ugyldig invitasjonslenke' }, { status: 400 })
  }

  // FIX 9 — strip newlines from senderName to prevent email header injection
  const sanitizedSenderName = senderName.replace(/[\r\n]/g, '')

  if (emails.length === 0) {
    return NextResponse.json({ error: 'Ingen e-postadresser oppgitt' }, { status: 400 })
  }

  if (emails.length > 50) {
    return NextResponse.json({ error: 'Maks 50 e-poster per kall' }, { status: 400 })
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Org ikke funnet' }, { status: 404 })

  // Separate valid and invalid addresses
  const validEmails = (emails as string[]).filter(e => typeof e === 'string' && EMAIL_RE.test(e.trim()))
  const invalidEmails = (emails as string[]).filter(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim()))

  const results = await Promise.allSettled(
    validEmails.map(email =>
      sendEmail({
        to: email.trim(),
        subject: `${sanitizedSenderName} inviterer deg til Quizkanonen`,
        html: orgInviteEmail(sanitizedSenderName, org.name, inviteUrl),
      })
    )
  )

  const sent = results.filter(r => r.status === 'fulfilled').length
  const failedSends = validEmails.filter((_, i) => results[i].status === 'rejected')

  return NextResponse.json({ sent, failed: [...invalidEmails, ...failedSends] })
}
