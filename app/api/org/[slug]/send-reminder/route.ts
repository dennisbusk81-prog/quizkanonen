import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'
import {
  REMINDER_ACTION,
  REMINDER_MAX_PER_CALL,
  resolveReminderQuota,
} from '@/lib/reminder-quota'

const DAY_MS = 24 * 60 * 60 * 1000

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
  if (userIds.length > REMINDER_MAX_PER_CALL) {
    return NextResponse.json({ error: `Maks ${REMINDER_MAX_PER_CALL} brukere per kall` }, { status: 400 })
  }
  if (userIds.some(id => typeof id !== 'string' || id.length === 0)) {
    return NextResponse.json({ error: 'Ugyldig bruker-id' }, { status: 400 })
  }

  // Duplikater fjernes: samme id 50 ganger er ren forsterkning, aldri en reell
  // påminnelse. Samme resonnement som i søsterruten send-invite.
  const requestedIds = [...new Set(userIds as string[])]

  // ── Mottakerne MÅ være medlemmer av DENNE orgen ────────────────────────────
  // Fram til nå ble userIds kun målt mot «maks 50». Bruker-UUID-er er
  // offentlige — /api/toppliste returnerer dem uten auth — så en gratis konto
  // kunne opprette en trial-org, bli admin i den og sende «Husk fredagsquizen»
  // fra hei@quizkanonen.no til 50 vilkårlige kontoer.
  //
  // AVVIS, IKKE FILTRER: er én id ikke medlem, sendes ingenting. En stille
  // filtrering ville sendt til de 49 andre og skjult at noen prøvde — og gjort
  // svaret {sent} til et orakel over hvilke id-er som er ekte kontoer.
  //
  // Oppslaget nøkles på de forespurte id-ene (høyst 50, godt under
  // .in()-grensen) i stedet for å hente hele medlemslista: en org uten
  // medlemsgrense (Pro/Enterprise) ville ellers møtt PostgRESTs stille
  // 1000-radskutt, og medlem nr. 1001 ville sett ut som en fremmed.
  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .in('user_id', requestedIds)

  // Ikke fått svar betyr UKJENT, aldri «er medlem». Kan vi ikke bekrefte
  // mottakerne, sendes ingenting.
  if (memberErr) {
    console.error('[send-reminder] kunne ikke slå opp medlemskap:', memberErr.message)
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte mottakerne akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }

  const memberIds = new Set((memberRows ?? []).map(r => r.user_id as string))
  if (requestedIds.some(id => !memberIds.has(id))) {
    // Ingen telling i svaret: hvor mange av id-ene som traff ville i seg selv
    // vært et (svakere) orakel over medlemslista.
    return NextResponse.json(
      { error: 'Mottakere må være medlemmer av bedriften.', code: 'not_a_member' },
      { status: 403 }
    )
  }

  // ── Døgnkvote per ORG ──────────────────────────────────────────────────────
  // IP-telleren over begrenser en maskin, ikke en organisasjon. Kvoten telles i
  // admin_actions (overlever kalde starter) og skaleres med medlemstallet — se
  // lib/reminder-quota.ts for hvorfor invitasjonskvotens tier-deling ikke passer.
  const { count: memberCount } = await supabaseAdmin
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)

  const quota = resolveReminderQuota(memberCount ?? 0)

  const since = new Date(Date.now() - DAY_MS).toISOString()
  const { count: sentLastDay, error: countErr } = await supabaseAdmin
    .from('admin_actions')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', REMINDER_ACTION)
    .eq('scope_type', 'organization')
    .eq('scope_id', organizationId)
    .gte('created_at', since)

  // Kan vi ikke bekrefte forbruket, faller vi tilbake til oppførselen fra før
  // kvoten fantes. I send-invite degraderer vi strengt her, fordi mottakerne
  // der er vilkårlige adresser; her er de allerede skåret mot medlemslista, så
  // taket er uansett bedriftens egne ansatte. En DB-hikke skal ikke stoppe en
  // ekte fredagsutsendelse — men den skal være synlig i loggen.
  if (countErr) {
    console.error('[send-reminder] kunne ikke telle døgnforbruk:', countErr.message)
  } else {
    const remaining = Math.max(0, quota.perDay - (sentLastDay ?? 0))
    if (requestedIds.length > remaining) {
      return NextResponse.json(
        {
          error: remaining === 0
            ? `Døgngrensen på ${quota.perDay} påminnelser er nådd. Prøv igjen i morgen.`
            : `Du kan sende ${remaining} påminnelse${remaining === 1 ? '' : 'r'} til i dag (grense: ${quota.perDay} per døgn).`,
          remaining,
          dayLimit: quota.perDay,
        },
        { status: 429 }
      )
    }
  }

  // Resolve emails via paginated listUsers (same pattern as cron/send-reminders)
  const targetIds = new Set(requestedIds)
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
  const html = `<p style="font-family:sans-serif;font-size:15px;color:#1a1c23;">Ukens quiz er åpen — logg inn på <a href="https://www.quizkanonen.no" style="color:#c9a84c;">quizkanonen.no</a> og spill før den stenger.</p>`

  let sent = 0
  for (let i = 0; i < emailsToSend.length; i += EMAIL_BATCH_SIZE) {
    const results = await Promise.allSettled(
      emailsToSend.slice(i, i + EMAIL_BATCH_SIZE).map(email =>
        sendEmail({ to: email, subject, html })
      )
    )
    sent += results.filter(r => r.status === 'fulfilled').length
  }

  // Bokfør forbruket. Feiler loggingen, er kvoten for neste kall for lav — det
  // er riktig vei å feile, men den må logges så den ikke blir usynlig.
  if (sent > 0) {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert(
      Array.from({ length: sent }, () => ({
        action_type: REMINDER_ACTION,
        scope_type: 'organization',
        scope_id: organizationId,
        user_id: user.id,
      }))
    )
    if (logErr) console.error('[send-reminder] kvote-logging feilet', organizationId, logErr.message)
  }

  // `sent` beholdes: app/org/[slug]/admin/page.tsx:1048 skriver «Påminnelse
  // sendt til N medlemmer» rett fra dette feltet. Etter medlemsskjæringen over
  // er N ikke lenger et orakel — hver id måtte allerede være medlem av en org
  // kalleren er admin i, og den lista kan admin se uansett.
  return NextResponse.json({ sent })
}
