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
  /** Sendinger som feilet transient — markøren står, neste kjøring prøver igjen. */
  emailFailed: number
  /** Rader ryddet uten e-post: utløpet er eldre enn GRACE_ENDED_EMAIL_MAX_AGE_DAYS. */
  clearedWithoutEmail: number
  error?: string
}

type OrgGraceResult = {
  reminded: number
  expiredOrgs: number
  lostPremium: number
  keptViaOtherSource: number
  cleanedStale: number
  /** Utløpte orgs som IKKE ble gjort helt opp — stempelet står, tas på nytt neste kjøring. */
  retrying: number
  error?: string
}

type PaymentGraceResult = {
  /** Utløpte karensperioder funnet i denne kjøringen. */
  expired: number
  /** Av dem: hvor mange som faktisk mistet Premium. */
  lostPremium: number
  /** Av dem: hvor mange som beholdt Premium via kode eller org. */
  keptViaOtherSource: number
  error?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Hvor gammelt et grace-utløp kan være og fortsatt utløse «Premium-tilgangen
 * din er avsluttet»-e-posten. Grace-feltet er nå også retry-markøren for
 * e-posten (se expireProfileGrace/expireOrgGrace), og en markør uten
 * aldersgrense har to problemer: rader som lå igjen fra før denne endringen
 * ville fått beskjeden uker på etterskudd ved første deploy, og en
 * permanent uleverbar mottaker ville holdt markøren åpen for alltid — med
 * daglige duplikater til alle andre i samme org som pris. 14 dager er rom
 * nok for enhver transient Resend-feil, og gammelt nok til at e-posten ikke
 * lenger informerer om noe brukeren ikke alt har oppdaget.
 */
const GRACE_ENDED_EMAIL_MAX_AGE_DAYS = 14

function expiredTooLongAgo(graceUntil: string | null, now: Date): boolean {
  if (!graceUntil) return false
  return now.getTime() - new Date(graceUntil).getTime() > GRACE_ENDED_EMAIL_MAX_AGE_DAYS * DAY_MS
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
  const paymentGrace = await expirePersonalPaymentGrace(now)

  const failed = !!profileGrace.error || !!orgGrace.error || !!paymentGrace.error
  return NextResponse.json({ profileGrace, orgGrace, paymentGrace }, { status: failed ? 500 : 200 })
}

// ── 3. Karensperiode etter betalingsfeil (B2C, 17. august 2026) ──────────────
//
// BACKSTOP, ikke hovedmekanismen. Normalveien er at Stripe kansellerer
// abonnementet når dunning-vinduet er ute, webhooken rydder karensen og
// rekalkulerer — se clearPersonalGrace i stripe-webhooken. Denne finnes fordi
// /api/profile/premium-status leser CACHEN (profiles.premium_status) og ikke
// regner tilstanden ut på nytt: uteblir `subscription.deleted` — mistet
// webhook, eller dunning satt til noe annet enn «cancel» i dashbordet — ville
// cachen stått igjen på true i det uendelige, og karensen blitt permanent
// Premium. Selve DEKNINGEN er allerede utløps-bevisst (isPersonalGraceActive
// sjekker `> now`), så dette retter cachen, ikke en åpen tilgangsvei.
//
// INGEN e-post herfra, med vilje: brukeren har fått betalingsfeil-e-posten med
// datoen i, og selve avslutningen varsles av subscription.deleted-grenen.
// Derfor trenger denne heller ingen retry-markør — markøren kan ryddes med én
// gang, i motsetning til de to seksjonene over.
async function expirePersonalPaymentGrace(now: Date): Promise<PaymentGraceResult> {
  const empty: PaymentGraceResult = { expired: 0, lostPremium: 0, keptViaOtherSource: 0 }

  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .not('personal_grace_until', 'is', null)
    .lt('personal_grace_until', now.toISOString())

  if (error) {
    // Typisk migrasjon 20260817000000 ikke kjørt ennå. Da finnes ingen
    // karensperioder å utløpe heller, så de to seksjonene over er upåvirket.
    console.error('[cron/expire-grace-periods] betalingskarens — query error:', error.code, error.message)
    return { ...empty, error: error.message }
  }

  if (!profiles || profiles.length === 0) return empty

  let lostPremium = 0
  let keptViaOtherSource = 0

  for (const p of profiles) {
    try {
      // Rekalkuler FØR markøren ryddes: en bruker kan ha verdikode eller
      // org-dekning som overlever betalingsfeilen, og den skal ikke ryke med.
      const state = await syncPremiumCache(p.id)
      if (state.isPremium) keptViaOtherSource++
      else lostPremium++

      const { error: clearError } = await supabaseAdmin
        .from('profiles')
        .update({ personal_grace_until: null, personal_grace_reason: null })
        .eq('id', p.id)
      if (clearError) {
        console.error(
          `[cron/expire-grace-periods] kunne ikke rydde betalingskarens for ${p.id}:`,
          clearError.code, clearError.message,
        )
      }
    } catch (err) {
      // Stripe nede under syncPremiumCache. Markøren står, og neste kjøring
      // tar raden på nytt — dekningen er utløpt uansett.
      console.error(`[cron/expire-grace-periods] betalingskarens feilet for ${p.id}:`, err)
    }
  }

  return { expired: profiles.length, lostPremium, keptViaOtherSource }
}

// ── 1. Profil-grace (uendret oppførsel) ──────────────────────────────────────

async function expireProfileGrace(now: Date): Promise<ProfileGraceResult> {
  const nowIso = now.toISOString()
  const empty: ProfileGraceResult = {
    expired: 0, keptViaOtherSource: 0, sent: 0, emailFailed: 0, clearedWithoutEmail: 0,
  }

  // Kandidat = markøren står: grace er satt og har utløpt.
  //
  // `premium_status = true`-filteret er FJERNET (16. august 2026): feltet er
  // nå også markøren for «avslutnings-e-posten er ikke bekreftet levert», og
  // en bruker som ble nedgradert i forrige kjøring — eller av en hvilken som
  // helst annen syncPremiumCache i mellomtiden — har premium_status=false.
  // Filteret ville gjemt nøyaktig radene retry-en finnes for. (Hullet fantes
  // også FØR denne endringen: rakk en annen sync å sette false mellom utløp
  // og cron, ble raden liggende for alltid og e-posten aldri sendt.)
  //
  // `personal_stripe_subscription_id IS NULL` er fortsatt fjernet som vakt:
  // kolonnen ble kun satt av Founders-flyten, så en vanlig betalende
  // B2C-kunde passerte den. Hver kandidat rekalkuleres mot alle kilder under.
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, org_premium_grace_until')
    .not('org_premium_grace_until', 'is', null)
    .lt('org_premium_grace_until', nowIso)

  if (error) {
    console.error('[cron/expire-grace-periods] query error:', error.message)
    return { ...empty, error: error.message }
  }

  if (!profiles || profiles.length === 0) return empty

  // REKKEFØLGEN er selve fiksen (16. august 2026). Fram til nå ble markøren
  // nullstilt FØRST og e-posten sendt til slutt — en 429 fra Resend kunne da
  // aldri tas igjen: brukeren mistet Premium og fikk aldri beskjed, og ingen
  // senere kjøring så raden. Nå:
  //
  //   1. NEDGRADERINGEN skjer først og UBETINGET (syncPremiumCache per
  //      bruker). Den venter aldri på e-posten. Det er trygt å la markøren
  //      stå under og etter rekalkuleringen: alle dekningslesere er
  //      utløps-bevisste (isOrgActive, getLockGraceUntil, premium-check,
  //      premium-status og trial-offer sjekker alle `> now`), så en
  //      utløpt-men-fortsatt-satt grace gir ingen tilgang noe sted.
  //   2. E-post sendes til dem som faktisk mistet Premium.
  //   3. Markøren nullstilles ETTERPÅ, kun for rader som er gjort opp:
  //      beholdt via annen kilde, bekreftet levert, uleverbar (ingen
  //      adresse), eller eldre enn GRACE_ENDED_EMAIL_MAX_AGE_DAYS. Feilet
  //      sending lar markøren stå — neste kjøring prøver igjen.
  const clearIds: string[] = []
  const lostRecent: string[] = []
  let keptViaOtherSource = 0
  let clearedWithoutEmail = 0

  for (const p of profiles) {
    try {
      const state = await syncPremiumCache(p.id)
      if (state.isPremium) {
        keptViaOtherSource++
        clearIds.push(p.id)
      } else if (expiredTooLongAgo(p.org_premium_grace_until, now)) {
        // «Tilgangen din er avsluttet» uker på etterskudd forvirrer mer enn
        // den informerer — rydd markøren uten e-post, men si det i loggen.
        console.error(
          `[cron/expire-grace-periods] grace utløp for over ${GRACE_ENDED_EMAIL_MAX_AGE_DAYS} ` +
          `dager siden for ${p.id} — rydder uten e-post`,
        )
        clearedWithoutEmail++
        clearIds.push(p.id)
      } else {
        lostRecent.push(p.id)
      }
    } catch (err) {
      // Vet ikke tilstanden — markøren står, neste kjøring prøver igjen.
      console.error('[cron/expire-grace-periods] hoppet over', p.id, '— kunne ikke avgjøre tilstand:', err)
    }
  }

  const emails = await sendGraceEndedEmails(lostRecent)
  clearIds.push(...emails.delivered, ...emails.unreachable)

  if (clearIds.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ org_premium_grace_until: null })
      .in('id', clearIds)

    if (updateError) {
      // Markørene står igjen; neste kjøring gjør jobben på nytt, med mulige
      // duplikat-e-poster til de leverte. Det er den billige feilen.
      console.error('[cron/expire-grace-periods] update error:', updateError.message)
      return {
        expired: lostRecent.length, keptViaOtherSource,
        sent: emails.delivered.length, emailFailed: emails.failed, clearedWithoutEmail,
        error: updateError.message,
      }
    }
  }

  return {
    expired: lostRecent.length, keptViaOtherSource,
    sent: emails.delivered.length, emailFailed: emails.failed, clearedWithoutEmail,
  }
}

// ── 2. Lås-grace på organisasjoner (29. juli 2026) ───────────────────────────

async function runOrgLockGrace(now: Date): Promise<OrgGraceResult> {
  const result: OrgGraceResult = {
    reminded: 0, expiredOrgs: 0, lostPremium: 0, keptViaOtherSource: 0, cleanedStale: 0,
    retrying: 0,
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
      const expired = await expireOrgGrace(org, now)
      if (expired) {
        if (expired.cleared) result.expiredOrgs++
        else result.retrying++
        result.lostPremium += expired.lost
        result.keptViaOtherSource += expired.kept
      } else {
        result.retrying++
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
 * Grace-perioden er over: rekalkuler hvert medlem, varsle dem som mistet
 * Premium, og fjern stempelet SIST.
 *
 * REKKEFØLGEN ble snudd 16. august 2026. Fram til da ble stempelet ryddet
 * FØRST, begrunnet med at det var ryddingen som fikk getOrgCoverage() til å
 * slutte å telle org-en som dekning. Det var upresist: getLockGraceUntil
 * filtrerer på `member_grace_until > now`, så en UTLØPT grace teller aldri
 * som dekning — ryddet eller ei. Prisen for den gamle rekkefølgen var
 * derimot reell: feilet medlemshentingen eller en e-post ETTER ryddingen,
 * fantes det ingenting igjen som fikk neste kjøring til å prøve på nytt.
 * Medlemmene mistet Premium uten å få vite det, for alltid.
 *
 * Nå er stempelet selve markøren for «denne utløpingen er ikke gjort opp»:
 *
 *   1. Nedgraderingen (syncPremiumCache per medlem) skjer først og venter
 *      aldri på e-post.
 *   2. E-post til dem som mistet Premium — med mindre utløpet er eldre enn
 *      GRACE_ENDED_EMAIL_MAX_AGE_DAYS, da er beskjeden foreldet.
 *   3. Stempelet ryddes KUN når alt er gjort opp: hvert medlem rekalkulert
 *      og hver e-post levert eller uleverbar. Ellers står det, og neste
 *      kjøring tar org-en på nytt — de som alt fikk e-posten kan da få den
 *      igjen. Duplikat er den billige feilen; en ansatt som mistet Premium
 *      uten beskjed er den dyre.
 */
async function expireOrgGrace(
  org: OrgGraceRow,
  now: Date,
): Promise<{ lost: number; kept: number; cleared: boolean } | null> {
  const { data: members, error: membersError } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)

  if (membersError) {
    // Stempelet står — org-en tas på nytt i morgen. (Før 16. august var
    // stempelet allerede ryddet her, og hele org-en falt stille ut.)
    console.error(
      `[cron/expire-grace-periods] kunne ikke hente medlemmer for utløpt grace org=${org.id}:`,
      membersError.message,
    )
    return null
  }

  const emailTooOld = expiredTooLongAgo(org.member_grace_until, now)
  const lostPremium: string[] = []
  let lostWithoutEmail = 0
  let kept = 0
  let syncFailures = 0
  for (const m of members ?? []) {
    const userId = m.user_id as string
    try {
      const state = await syncPremiumCache(userId)
      if (state.isPremium) kept++
      else if (emailTooOld) lostWithoutEmail++
      else lostPremium.push(userId)
    } catch (err) {
      syncFailures++
      console.error(
        `[cron/expire-grace-periods] hoppet over ${userId} i org=${org.id} — kunne ikke avgjøre tilstand:`,
        err,
      )
    }
  }

  if (lostWithoutEmail > 0) {
    console.error(
      `[cron/expire-grace-periods] grace utløp for over ${GRACE_ENDED_EMAIL_MAX_AGE_DAYS} dager ` +
      `siden for org=${org.id} — ${lostWithoutEmail} medlem(mer) nedgradert uten e-post`,
    )
  }

  const emails = await sendGraceEndedEmails(lostPremium)
  const lost = lostPremium.length + lostWithoutEmail
  console.log(
    `[cron/expire-grace-periods] lås-grace utløpt org=${org.id} (${org.name ?? 'uten navn'}) — ` +
    `${lost} mistet Premium, ${kept} dekket av annen kilde, ${emails.delivered.length} varslet`
  )

  const allSettledUp = syncFailures === 0
    && emails.delivered.length + emails.unreachable.length === lostPremium.length

  if (!allSettledUp) {
    console.error(
      `[cron/expire-grace-periods] lås-grace org=${org.id} IKKE gjort helt opp ` +
      `(${syncFailures} rekalkuleringer og ${emails.failed} e-poster feilet) — ` +
      `stempelet står, org-en tas på nytt neste kjøring`,
    )
    return { lost, kept, cleared: false }
  }

  const cleared = await clearOrgGrace(org.id, 'grace utløpt')
  return { lost, kept, cleared }
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
 *
 * STEMPLING KREVER FULL LEVERANSE (16. august 2026). Stempelet
 * `member_grace_reminded_at` er ETT felt som dekker BÅDE ansatte og admins,
 * mens sendingene er per person. Fram til nå holdt det at noe som helst ble
 * SENDT — admin-grenen satte til og med flagget uten å se på resultatet, så
 * én forsøkt (ikke engang levert) admin-e-post stemplet bort alle ansatte
 * som fikk 429 i samme kjøring. Nå stemples det kun når alt som skulle
 * sendes faktisk ble levert; ellers står stempelet, og neste kjøring tar
 * hele orgen på nytt. De som alt fikk påminnelsen kan da få den én gang til
 * — samme avveining som over, og gjentakelsen er begrenset av det samme
 * to-dagersvinduet. (Å stemple ansatte og admins hver for seg krever en ny
 * kolonne og er en egen sak.)
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
  let allDelivered = true

  // 1. De ansatte.
  const lookup = await getOrgMemberEmails(org.id, { excludeAdmins: true })
  if (lookup === null) {
    console.error(`[cron/expire-grace-periods] påminnelse til ansatte HOPPET OVER — oppslag feilet. org=${org.id}`)
    allDelivered = false
  } else if (lookup.memberCount > 0 && lookup.emails.length === 0) {
    console.error(
      `[cron/expire-grace-periods] påminnelse til ansatte HOPPET OVER — ingen e-postadresser for ` +
      `${lookup.memberCount} medlem(mer). org=${org.id}`
    )
    allDelivered = false
  } else if (lookup.emails.length > 0) {
    const { delivered } = await sendEmailToMany(
      lookup.emails,
      {
        subject: `Premium gjennom ${org.name} utløper snart — Quizkanonen`,
        html: orgGraceReminderEmail(org.name, graceUntil),
      },
      `grace-reminder org=${org.id}`,
    )
    if (delivered.length > 0) anythingSent = true
    if (delivered.length < lookup.emails.length) allDelivered = false
    console.log(
      `[cron/expire-grace-periods] grace-påminnelse til ${delivered.length}/${lookup.emails.length} ansatte org=${org.id}`,
    )
  }
  // (memberCount === 0: org uten ordinære ansatte er normalt — blokkerer ikke stempling.)

  // 2. Administratorene.
  const { emails: adminEmails, orgName, orgSlug } = await getOrgAdminEmails(org.id)
  if (adminEmails.length > 0 && orgName && orgSlug) {
    const { delivered } = await sendToOrgAdmins(
      adminEmails,
      {
        subject: `De ansatte mister Premium snart — ${orgName}`,
        html: orgGraceReminderAdminEmail(orgName, orgSlug, graceUntil),
      },
      `grace-reminder-admin org=${org.id}`,
    )
    if (delivered.length > 0) anythingSent = true
    if (delivered.length < adminEmails.length) allDelivered = false
  } else {
    console.error(
      `[cron/expire-grace-periods] admin-påminnelse HOPPET OVER — ingen mottakere eller manglende felt. ` +
      `org=${org.id}, orgName=${orgName ?? 'null'}, orgSlug=${orgSlug ?? 'null'}`
    )
    allDelivered = false
  }

  if (!anythingSent) return false

  if (!allDelivered) {
    console.error(
      `[cron/expire-grace-periods] delvis leveranse av grace-påminnelsen org=${org.id} — ` +
      `stempler IKKE; hele orgen tas på nytt neste kjøring`,
    )
    return false
  }

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

type GraceEmailOutcome = {
  /** Bruker-id-er der sendEmail bekreftet lyktes. */
  delivered: string[]
  /**
   * Bruker-id-er uten e-postadresse. Kan aldri leveres, så de regnes som
   * gjort opp — å la dem holde markøren åpen ville gitt daglige duplikater
   * til alle andre i samme kjøring, uten at noen retry noensinne kan lykkes.
   */
  unreachable: string[]
  /** Antall transiente feil (oppslag eller sending) — disse skal prøves igjen. */
  failed: number
}

/**
 * «Premium-tilgangen din er avsluttet» til dem som faktisk mistet den. Delt av
 * begge grace-kildene — samme beskjed, samme mal.
 *
 * Returnerer HVEM som ble levert, ikke bare et antall (16. august 2026):
 * kallerne bruker utfallet til å avgjøre hvilke markører som kan ryddes, og
 * et rent antall kan ikke skille «disse to fikk den» fra «de to andre».
 */
async function sendGraceEndedEmails(userIds: string[]): Promise<GraceEmailOutcome> {
  const outcome: GraceEmailOutcome = { delivered: [], unreachable: [], failed: 0 }
  if (userIds.length === 0) return outcome

  const html = gracePeriodEndedEmail()
  const subject = 'Premium-tilgangen din er avsluttet'

  for (const id of userIds) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(id)
      if (!user?.email) {
        console.error('[cron/expire-grace-periods] ingen e-postadresse for', id, '— varselet kan ikke leveres')
        outcome.unreachable.push(id)
        continue
      }
      await sendEmail({ to: user.email, subject, html })
      outcome.delivered.push(id)
    } catch (err) {
      outcome.failed++
      console.error('[cron/expire-grace-periods] sendEmail feil for', id, err)
    }
  }

  return outcome
}
