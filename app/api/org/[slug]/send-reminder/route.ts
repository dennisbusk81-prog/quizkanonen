import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'

// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // organizationId er UUID her, ikke en slug — kun param-namn er endret for Next.js routing-konsistens
  const { slug: organizationId } = await params

  // Conservative rate limit — this sends emails
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `send-reminder:${ip}`
  if (!(await rateLimitShared(rlKey, 5, 3_600_000)).success) {
    logRateLimitHit(rlKey, { lag: 'delt', limit: 5, windowMs: 3_600_000 })
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

  // Låst org: e-post fra hei@quizkanonen.no på vegne av en bedrift som ikke betaler.
  const lock = await requireUnlockedOrg({ id: organizationId })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  let body: { userIds?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { userIds } = body
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: 'Ingen brukere oppgitt' }, { status: 400 })
  }
  if (userIds.length > 50) {
    return NextResponse.json({ error: 'Maks 50 brukere per kall' }, { status: 400 })
  }

  // Resolve emails via paginated listUsers (same pattern as cron/send-reminders)
  const targetIds = new Set(userIds as string[])
  const emailsByUserId = new Map<string, string>()
  let page = 1
  while (true) {
    const { data: authData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (listErr) break
    const users = authData?.users ?? []
    for (const u of users) {
      if (u.email && targetIds.has(u.id)) emailsByUserId.set(u.id, u.email)
    }
    if (users.length < 1000) break
    page++
  }

  const emailsToSend = [...emailsByUserId.values()]
  if (emailsToSend.length === 0) return NextResponse.json({ sent: 0 })

  const subject = 'Husk fredagsquizen! 🎯'
  const html = `<p style="font-family:sans-serif;font-size:15px;color:#1a1c23;">Ukens quiz er åpen — logg inn på <a href="https://quizkanonen.no" style="color:#c9a84c;">quizkanonen.no</a> og spill før den stenger.</p>`

  let sent = 0
  for (let i = 0; i < emailsToSend.length; i += EMAIL_BATCH_SIZE) {
    const results = await Promise.allSettled(
      emailsToSend.slice(i, i + EMAIL_BATCH_SIZE).map(email =>
        sendEmail({ to: email, subject, html })
      )
    )
    sent += results.filter(r => r.status === 'fulfilled').length
  }

  return NextResponse.json({ sent })
}
