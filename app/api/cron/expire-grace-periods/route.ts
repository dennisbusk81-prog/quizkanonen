import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { sendEmailToMany } from '@/lib/send-email-many'
import {
  gracePeriodEndedEmail,
  orgGraceReminderEmail,
  orgGraceReminderAdminEmail,
} from '@/lib/email-templates'
import { syncPremiumCache } from '@/lib/premium-state-io'
import { getOrgMemberEmails } from '@/lib/org-lock-notify'
import { getOrgAdminEmails, sendToOrgAdmins } from '@/lib/org-admin-emails'
import {
  shouldRemindDuringGrace,
  isGraceExpired,
  CLEARED_GRACE,
} from '@/lib/org-lock-grace'

// GET /api/cron/expire-grace-periods — kjøres daglig (registrert hos cron-job.org,
// ikke i vercel.json). Beskyttet med CRON_SECRET, samme mønster som de andre
// cron-rutene.
//
// Ruten har TO grace-kilder å rydde etter, og de deler jobb-beskrivelse men ikke
// datamodell:
//
//   1. PROFIL-GRACE (profiles.org_premium_grace_until) — brukeren ble fjernet
//      fra en org, eller org-en ble slettet. Én rad per bruker.
//   2. LÅS-GRACE (organizations.member_grace_until, 29. juli 2026) — org-en ble
//      låst UFRIVILLIG, altså utløpt trial eller avvist kort. Én rad per org,
//      som dekker alle medlemmene. Se lib/org-lock-grace.ts.
//
// Lås-grace er lagt her framfor i en ny cron-rute med vilje: jobben er den samme
// («grace løp ut → rekalkuler mot alle kilder → varsle kun dem som faktisk
// mistet noe»), og denne ruten er allerede schedulert. En ny rute måtte
// registreres manuelt, og en cron som aldri blir registrert kjører aldri — uten
// et eneste feilspor.

type ProfileGraceResult = {
  expired: number
  keptViaOtherSource: number
  sent: number
  error?: string
}

type OrgGraceResult = {
  reminded: number
  expiredOrgs: number
  lostPremium: number
  keptViaOtherSource: number
  cleanedStale: number
  error?: string
}

// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // De to seksjonene kjøres uavhengig: en feil i den ene skal ikke gjøre at den
  // andre hoppes over. Særlig viktig mens migrasjon 20260737000000 ennå ikke er
  // kjørt i prod — da feiler org-seksjonen på en manglende kolonne, og
  // profil-graceen skal fortsatt ryddes som før.
  const profileGrace = await expireProfileGrace(now)
  const orgGrace = await runOrgLockGrace(now)

  const failed = !!profileGrace.error || !!orgGrace.error
  return NextResponse.json({ profileGrace, orgGrace }, { status: failed ? 500 : 200 })
}

// ── 1. Profil-grace (uendret oppførsel) ──────────────────────────────────────

async function expireProfileGrace(now: Date): Promise<ProfileGraceResult> {
  const nowIso = now.toISOString()

  // Profiler der grace har utløpt og som fortsatt er markert Premium.
  // `personal_stripe_subscription_id IS NULL` er FJERNET som vakt: kolonnen ble
  // kun satt av Founders-flyten, så en vanlig betalende B2C-kunde passerte den.
  // Hver kandidat rekalkuleres mot alle kilder under i stedet.
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('premium_status', true)
    .not('org_premium_grace_until', 'is', null)
    .lt('org_premium_grace_until', nowIso)

  if (error) {
    console.error('[cron/expire-grace-periods] query error:', error.message)
    return { expired: 0, keptViaOtherSource: 0, sent: 0, error: error.message }
  }

  if (!profiles || profiles.length === 0) {
    return { expired: 0, keptViaOtherSource: 0, sent: 0 }
  }

  const ids = profiles.map(p => p.id)

  // Nullstill grace-stempelet, og rekalkuler Premium per bruker i stedet for å
  // slå det av blindt: en verdikode eller et eget abonnement skal overleve at
  // org-grace-perioden løper ut.
  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ org_premium_grace_until: null })
    .in('id', ids)

  if (updateError) {
    console.error('[cron/expire-grace-periods] update error:', updateError.message)
    return { expired: 0, keptViaOtherSource: 0, sent: 0, error: updateError.message }
  }

  const lostPremium: string[] = []
  let keptViaOtherSource = 0
  for (const id of ids) {
    try {
      const state = await syncPremiumCache(id)
      if (state.isPremium) keptViaOtherSource++
      else lostPremium.push(id)
    } catch (err) {
      console.error('[cron/expire-grace-periods] hoppet over', id, '— kunne ikke avgjøre tilstand:', err)
    }
  }

  const sent = await sendGraceEndedEmails(lostPremium)
  return { expired: lostPremium.length, keptViaOtherSource, sent }
}

// ── 2. Lås-grace på organisasjoner (29. juli 2026) ───────────────────────────

async function runOrgLockGrace(now: Date): Promise<OrgGraceResult> {
  const result: OrgGraceResult = {
    reminded: 0, expiredOrgs: 0, lostPremium: 0, keptViaOtherSource: 0, cleanedStale: 0,
  }

  const { data: orgs, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, subscription_status, member_grace_until, member_grace_reason, member_grace_reminded_at')
    .not('member_grace_until', 'is', null)

  if (error) {
    // 42703 her betyr at migrasjonen ikke er kjørt ennå. Det er ikke stille:
    // koden sier fra, og profil-graceen over er upåvirket.
    console.error('[cron/expire-grace-periods] kunne ikke lese lås-grace:', error.code, error.message)
    return { ...result, error: error.message }
  }

  for (const org of orgs ?? []) {
    const graceUntil = org.member_grace_until as string | null

    // Org-en er frisk igjen, men stempelet ble stående — typisk fordi
    // ryddingen i webhooken feilet. Ingen e-post skal ut for dette; grace er
    // uansett virkningsløs på en org som ikke står som låst (getOrgCoverage
    // krever 'locked'). Vi rydder bare opp så kolonnen ikke lyver.
    if (org.subscription_status !== 'locked') {
      const cleared = await clearOrgGrace(org.id, 'org ikke lenger låst')
      if (cleared) result.cleanedStale++
      continue
    }

    if (isGraceExpired(graceUntil, now)) {
      const expired = await expireOrgGrace(org)
      if (expired) {
        result.expiredOrgs++
        result.lostPremium += expired.lost
        result.keptViaOtherSource += expired.kept
      }
      continue
    }

    if (shouldRemindDuringGrace(
      {
        member_grace_until: graceUntil,
        member_grace_reminded_at: org.member_grace_reminded_at as string | null,
      },
      now,
    )) {
      const reminded = await remindOrgGrace(org)
      if (reminded) result.reminded++
    }
  }

  return result
}

type OrgGraceRow = {
  id: string
  name: string | null
  slug: string | null
  member_grace_until: string | null
}

/**
 * Grace-perioden er over: fjern stempelet og rekalkuler hvert medlem.
 *
 * Stempelet ryddes FØR rekalkuleringen — det er nettopp det som gjør at
 * getOrgCoverage() slutter å telle org-en som dekning. Feiler ryddingen,
 * avbryter vi hele org-en i stedet for å rekalkulere mot en tilstand vi ikke
 * fikk skrevet: da beholder de ansatte tilgangen ett døgn ekstra og vi prøver
 * igjen i morgen, i stedet for å skru av Premium på et halvskrevet grunnlag.
 */
async function expireOrgGrace(org: OrgGraceRow): Promise<{ lost: number; kept: number } | null> {
  const cleared = await clearOrgGrace(org.id, 'grace utløpt')
  if (!cleared) return null

  const { data: members, error: membersError } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)

  if (membersError) {
    console.error(
      `[cron/expire-grace-periods] kunne ikke hente medlemmer for utløpt grace org=${org.id}:`,
      membersError.message,
    )
    return null
  }

  const lostPremium: string[] = []
  let kept = 0
  for (const m of members ?? []) {
    const userId = m.user_id as string
    try {
      const state = await syncPremiumCache(userId)
      if (state.isPremium) kept++
      else lostPremium.push(userId)
    } catch (err) {
      console.error(
        `[cron/expire-grace-periods] hoppet over ${userId} i org=${org.id} — kunne ikke avgjøre tilstand:`,
        err,
      )
    }
  }

  const sent = await sendGraceEndedEmails(lostPremium)
  console.log(
    `[cron/expire-grace-periods] lås-grace utløpt org=${org.id} (${org.name ?? 'uten navn'}) — ` +
    `${lostPremium.length} mistet Premium, ${kept} dekket av annen kilde, ${sent} varslet`
  )

  return { lost: lostPremium.length, kept }
}

/**
 * Påminnelse et par dager før grace utløper.
 *
 * BÅDE ansatte og admin varsles, men med hver sin tekst og hvert sitt poeng:
 * den ansatte kan tegne eget abonnement, admin kan fikse betalingen. Dette er
 * IKKE en gjentakelse av lås-e-posten som gikk ut da org-en ble låst — den
 * handlet om at betalingen stoppet, denne om at de ansatte mister tilgangen på
 * en bestemt dato.
 *
 * Dedupe-stempelet settes ETTER sending. Feiler stemplingen, kan påminnelsen
 * gjentas i morgen — men vinduet er kun to dager, så en gjentakelse er
 * begrenset til et par e-poster. Motsatt rekkefølge kunne gitt null varsel i
 * det hele tatt, og det er den dyrere feilen her.
 */
async function remindOrgGrace(org: OrgGraceRow): Promise<boolean> {
  const graceUntil = org.member_grace_until
  if (!graceUntil || !org.name) {
    console.error(
      `[cron/expire-grace-periods] påminnelse HOPPET OVER — mangler felt. ` +
      `org=${org.id} name=${org.name ?? 'null'} until=${graceUntil ?? 'null'}`
    )
    return false
  }

  let anythingSent = false

  // 1. De ansatte.
  const lookup = await getOrgMemberEmails(org.id, { excludeAdmins: true })
  if (lookup === null) {
    console.error(`[cron/expire-grace-periods] påminnelse til ansatte HOPPET OVER — oppslag feilet. org=${org.id}`)
  } else if (lookup.memberCount > 0 && lookup.emails.length === 0) {
    console.error(
      `[cron/expire-grace-periods] påminnelse til ansatte HOPPET OVER — ingen e-postadresser for ` +
      `${lookup.memberCount} medlem(mer). org=${org.id}`
    )
  } else if (lookup.emails.length > 0) {
    const { sent } = await sendEmailToMany(
      lookup.emails,
      {
        subject: `Premium gjennom ${org.name} utløper snart — Quizkanonen`,
        html: orgGraceReminderEmail(org.name, graceUntil),
      },
      `grace-reminder org=${org.id}`,
    )
    if (sent > 0) anythingSent = true
    console.log(`[cron/expire-grace-periods] grace-påminnelse til ${sent}/${lookup.emails.length} ansatte org=${org.id}`)
  }

  // 2. Administratorene.
  const { emails: adminEmails, orgName, orgSlug } = await getOrgAdminEmails(org.id)
  if (adminEmails.length > 0 && orgName && orgSlug) {
    await sendToOrgAdmins(
      adminEmails,
      {
        subject: `De ansatte mister Premium snart — ${orgName}`,
        html: orgGraceReminderAdminEmail(orgName, orgSlug, graceUntil),
      },
      `grace-reminder-admin org=${org.id}`,
    )
    anythingSent = true
  } else {
    console.error(
      `[cron/expire-grace-periods] admin-påminnelse HOPPET OVER — ingen mottakere eller manglende felt. ` +
      `org=${org.id}, orgName=${orgName ?? 'null'}, orgSlug=${orgSlug ?? 'null'}`
    )
  }

  if (!anythingSent) return false

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ member_grace_reminded_at: new Date().toISOString() })
    .eq('id', org.id)

  if (error) {
    console.error(
      `[cron/expire-grace-periods] kunne ikke stemple påminnelsen org=${org.id} — ` +
      `den kan gjentas ved neste kjøring:`, error.code, error.message,
    )
  }

  return true
}

async function clearOrgGrace(organizationId: string, why: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('organizations')
    .update(CLEARED_GRACE)
    .eq('id', organizationId)

  if (error) {
    console.error(
      `[cron/expire-grace-periods] kunne ikke rydde lås-grace org=${organizationId} (${why}):`,
      error.code, error.message,
    )
    return false
  }
  return true
}

/**
 * «Premium-tilgangen din er avsluttet» til dem som faktisk mistet den. Delt av
 * begge grace-kildene — samme beskjed, samme mal.
 */
async function sendGraceEndedEmails(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0

  const html = gracePeriodEndedEmail()
  const subject = 'Premium-tilgangen din er avsluttet'
  let sent = 0

  for (const id of userIds) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(id)
      if (user?.email) {
        await sendEmail({ to: user.email, subject, html })
        sent++
      }
    } catch (err) {
      console.error('[cron/expire-grace-periods] sendEmail feil for', id, err)
    }
  }

  return sent
}
