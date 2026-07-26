import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { orgInviteEmail } from '@/lib/email-templates'
import { rateLimit } from '@/lib/rate-limit'
import { resolveInviteQuota } from '@/lib/invite-quota'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Døgnkvoten telles i den eksisterende admin_actions-tabellen: én rad per sendt
// invitasjon. En modul-lokal Map (lib/rate-limit) duger ikke her — den lever per
// serverless-instans, så en angriper får en fersk kvote for hver kalde start.
const INVITE_ACTION = 'org_invite_email'
const DAY_MS = 24 * 60 * 60 * 1000

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

  // Per-bruker i tillegg til per-IP: IP-er roteres billig, bruker-id-er ikke.
  if (!rateLimit(`send-invite-user:${user.id}`, 5, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

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

  let body: { emails?: unknown; inviteUrl?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { emails, inviteUrl } = body

  if (!Array.isArray(emails) || typeof inviteUrl !== 'string') {
    return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 })
  }

  // FIX 9 — validate inviteUrl against our own domain to prevent phishing links in emails
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  if (!siteUrl || !inviteUrl.startsWith(siteUrl)) {
    return NextResponse.json({ error: 'Ugyldig invitasjonslenke' }, { status: 400 })
  }

  if (emails.length === 0) {
    return NextResponse.json({ error: 'Ingen e-postadresser oppgitt' }, { status: 400 })
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, created_at, subscription_status')
    .eq('id', organizationId)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Org ikke funnet' }, { status: 404 })

  // ── Avsendernavn ────────────────────────────────────────────────────────────
  // Utledes server-side fra profilen, som håndhever navnepolicyen
  // (/^[\p{L}\s\-']{2,40}$/u i /api/profile/upsert). Tidligere kom navnet rått
  // fra request-body, så hvem som helst kunne skrive vilkårlig tekst inn i en
  // e-post sendt fra hei@quizkanonen.no. Klienten sender samme verdi den alltid
  // har sendt — ingen synlig endring for en ekte admin.
  const { data: senderProfile } = await supabaseAdmin
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle()

  const senderName = (senderProfile?.display_name ?? '').trim() || 'En kollega'

  // ── Kvote ───────────────────────────────────────────────────────────────────
  const { count: memberCount } = await supabaseAdmin
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)

  const quota = resolveInviteQuota({
    subscriptionStatus: org.subscription_status,
    createdAt: org.created_at,
    memberCount: memberCount ?? 0,
  })

  if (emails.length > quota.perCall) {
    return NextResponse.json(
      { error: `Maks ${quota.perCall} e-poster per kall` },
      { status: 400 }
    )
  }

  // Separate valid and invalid addresses. Duplikater fjernes (samme adresse
  // 50 ganger er ren forsterkning, aldri en reell invitasjon).
  const rawList = emails as unknown[]
  const invalidEmails = rawList.filter(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim())) as string[]
  const validEmails = [...new Set(
    rawList
      .filter((e): e is string => typeof e === 'string' && EMAIL_RE.test(e.trim()))
      .map(e => e.trim().toLowerCase())
  )]

  if (validEmails.length === 0) {
    return NextResponse.json({ sent: 0, failed: invalidEmails })
  }

  // Døgnforbruk.
  const since = new Date(Date.now() - DAY_MS).toISOString()
  const { count: sentLastDay, error: countErr } = await supabaseAdmin
    .from('admin_actions')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', INVITE_ACTION)
    .eq('scope_type', 'organization')
    .eq('scope_id', organizationId)
    .gte('created_at', since)

  // Kan vi ikke bekrefte forbruket, degraderer vi strengt for uverifiserte
  // orger: en DB-feil skal ikke kunne brukes som omvei rundt kvoten. En
  // etablert org (som Elkjøp) slipper gjennom på per-kall-grensen alene, slik
  // at en forbigående DB-hikke ikke stopper en ekte utsendelse.
  if (countErr) {
    console.error('[send-invite] kunne ikke telle døgnforbruk:', countErr.message)
    if (quota.tier === 'ny') {
      return NextResponse.json(
        { error: 'Kunne ikke bekrefte sendekvoten akkurat nå. Prøv igjen om litt.' },
        { status: 503 }
      )
    }
  } else {
    const usedToday = sentLastDay ?? 0
    const remaining = Math.max(0, quota.perDay - usedToday)

    if (validEmails.length > remaining) {
      return NextResponse.json(
        {
          error: remaining === 0
            ? `Døgngrensen på ${quota.perDay} invitasjoner er nådd. Prøv igjen i morgen, eller del invitasjonslenken direkte.`
            : `Du kan sende ${remaining} invitasjon${remaining === 1 ? '' : 'er'} til i dag (grense: ${quota.perDay} per døgn). Del gjerne invitasjonslenken direkte i mellomtiden.`,
          remaining,
          dayLimit: quota.perDay,
        },
        { status: 429 }
      )
    }
  }

  const results = await Promise.allSettled(
    validEmails.map(email =>
      sendEmail({
        to: email,
        subject: `${senderName} inviterer deg til Quizkanonen`,
        html: orgInviteEmail(senderName, org.name, inviteUrl),
      })
    )
  )

  const sentEmails = validEmails.filter((_, i) => results[i].status === 'fulfilled')
  const failedSends = validEmails.filter((_, i) => results[i].status === 'rejected')

  // Bokfør forbruket. Feiler loggingen, er kvoten for neste kall for lav —
  // det er riktig vei å feile, men den må logges så den ikke blir usynlig.
  if (sentEmails.length > 0) {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert(
      sentEmails.map(() => ({
        action_type: INVITE_ACTION,
        scope_type: 'organization',
        scope_id: organizationId,
        user_id: user.id,
      }))
    )
    if (logErr) console.error('[send-invite] kvote-logging feilet', organizationId, logErr.message)
  }

  return NextResponse.json({ sent: sentEmails.length, failed: [...invalidEmails, ...failedSends] })
}
