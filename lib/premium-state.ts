// ── Autoritativ premium-tilstand ─────────────────────────────────────────────
//
// PROBLEMET DENNE FILEN LØSER
// Premium kan komme fra fire kilder — verdikode, Founders-trial, personlig
// Stripe-abonnement og org-medlemskap — men databasen lagret bare ÉN
// (profiles.premium_source). En bruker kan reelt ha flere samtidig, og da mistet
// modellen informasjon. Følgene var konkrete: en cron kunne slå av Premium for en
// betalende kunde, og en kunde kunne bli belastet for en periode de samtidig
// fikk gratis via kode.
//
// Reglene er delt i to: decide*-funksjonene er RENE (ingen I/O) og
// mutasjonstestet, mens get*-funksjonene bare henter input. Samme mønster som
// lib/answer-key-correction.ts og lib/invite-quota.ts.
//
// premium_status/premium_source på profiles beholdes som cache for raske
// spørringer, men autoritative beslutninger — innløsning, utløp, pause — tas mot
// decidePremiumState().

export type PremiumSourceKind = 'code' | 'stripe' | 'org'

/** Aktiv kode-periode. expiresAt = null betyr permanent. */
export type CodeCoverage = {
  redemptionId: string
  codeId: string
  expiresAt: string | null
}

/**
 * Brukerens personlige Stripe-abonnement — Founders-trial OG betalt B2C er
 * samme sak her. Det som skiller dem er status ('trialing' vs 'active'), ikke
 * hvilken kodesti som opprettet dem, og beslutningene under trenger bare å vite
 * når dekningen løper ut.
 */
export type StripeCoverage = {
  subscriptionId: string
  status: string
  /** Slutt på trial-perioden (trialing), ISO. */
  trialEnd: string | null
  /** Slutt på inneværende betalte periode (active), ISO. */
  currentPeriodEnd: string | null
  /** Satt hvis innkrevingen allerede er pauset. */
  pauseResumesAt: string | null
}

export type OrgCoverage = {
  orgIds: string[]
  orgNames: string[]
  graceUntil: string | null
}

export type PremiumStateInput = {
  code: CodeCoverage | null
  stripe: StripeCoverage | null
  org: OrgCoverage | null
  now?: Date
}

export type PremiumState = {
  isPremium: boolean
  sources: {
    code: CodeCoverage | null
    stripe: StripeCoverage | null
    org: OrgCoverage | null
  }
  /** Når den nåværende dekningen løper ut. null = ingen kjent utløpsdato. */
  effectiveUntil: string | null
  /** Hva som skjer når effectiveUntil passerer. */
  whatHappensAtExpiry:
    | 'nothing'            // ingen dekning nå, eller permanent dekning
    | 'falls_back_to_stripe'
    | 'falls_back_to_org'
    | 'loses_premium'
}

const LIVE_STRIPE_STATUSES = ['active', 'trialing']

function isFuture(iso: string | null, now: Date): boolean {
  return !!iso && new Date(iso) > now
}

/** Slutten på dekningen et abonnement gir akkurat nå. */
export function stripeCoverageEnd(sub: StripeCoverage): string | null {
  if (sub.status === 'trialing') return sub.trialEnd ?? sub.currentPeriodEnd
  return sub.currentPeriodEnd ?? sub.trialEnd
}

export function isStripeLive(sub: StripeCoverage | null): sub is StripeCoverage {
  return !!sub && LIVE_STRIPE_STATUSES.includes(sub.status)
}

export function isCodeActive(code: CodeCoverage | null, now: Date): boolean {
  if (!code) return false
  return code.expiresAt === null || new Date(code.expiresAt) > now
}

export function isOrgActive(org: OrgCoverage | null, now: Date): boolean {
  if (!org) return false
  return org.orgIds.length > 0 || isFuture(org.graceUntil, now)
}

/**
 * Ren utledning av full premium-tilstand fra alle kilder.
 *
 * Merk at rekkefølgen i whatHappensAtExpiry er bevisst: org-dekning og et levende
 * abonnement overlever at en kode-periode løper ut, og det er nettopp DEN
 * kunnskapen de seks nedgraderings-stedene manglet da de satte premium_status
 * til false uten å spørre.
 */
export function decidePremiumState(input: PremiumStateInput): PremiumState {
  const now = input.now ?? new Date()
  const { code, stripe, org } = input

  const codeActive = isCodeActive(code, now)
  const stripeLive = isStripeLive(stripe)
  const orgActive = isOrgActive(org, now)

  const isPremium = codeActive || stripeLive || orgActive

  // Utløpet som gjelder er den kilden som varer lengst.
  const candidates: string[] = []
  if (codeActive && code?.expiresAt) candidates.push(code.expiresAt)
  if (stripeLive && stripe) {
    const end = stripeCoverageEnd(stripe)
    if (end) candidates.push(end)
  }
  if (orgActive && org?.orgIds.length === 0 && org.graceUntil) candidates.push(org.graceUntil)

  // Ubestemt dekning: en kode uten utløp, eller et aktivt org-MEDLEMSKAP.
  // En grace-periode teller ikke — den er nettopp tidsbegrenset.
  const orgIndefinite = (org?.orgIds.length ?? 0) > 0
  const permanentCode = codeActive && code?.expiresAt === null
  const permanent = permanentCode || orgIndefinite

  const effectiveUntil = permanent || candidates.length === 0
    ? null
    : candidates.sort()[candidates.length - 1]

  // Hva som står igjen når den tidsbegrensede dekningen løper ut. Dette er
  // spørsmålet cron-ene stiller: skal brukeren miste Premium og få
  // avslutnings-e-post, eller dekkes de fortsatt av noe annet?
  //
  // Et levende abonnement «utløper» ikke — det fornyes — så det regnes ikke som
  // tap. En grace-periode gjør det derimot.
  let whatHappensAtExpiry: PremiumState['whatHappensAtExpiry'] = 'nothing'
  if (!isPremium) {
    whatHappensAtExpiry = 'nothing'
  } else if (codeActive && code?.expiresAt) {
    whatHappensAtExpiry = orgIndefinite
      ? 'falls_back_to_org'
      : stripeLive
        ? 'falls_back_to_stripe'
        : 'loses_premium'
  } else if (permanent || stripeLive) {
    whatHappensAtExpiry = 'nothing'
  } else {
    // Kun en grace-periode igjen.
    whatHappensAtExpiry = 'loses_premium'
  }

  return {
    isPremium,
    sources: { code: codeActive ? code : null, stripe: stripeLive ? stripe : null, org: orgActive ? org : null },
    effectiveUntil,
    whatHappensAtExpiry,
  }
}

// ── Innløsningsbeslutning ────────────────────────────────────────────────────

export type RedemptionDecision =
  | { action: 'reject'; reason: 'org_covered' | 'code_active'; message: string }
  | {
      action: 'grant'
      /** Når kode-perioden starter. Stables etter eksisterende dekning. */
      startsAt: string
      /** null = permanent kode. */
      expiresAt: string | null
      /** Satt når et levende abonnement må pauses for perioden. */
      pause: { subscriptionId: string; resumesAt: string | null } | null
    }

const DAY_MS = 24 * 60 * 60 * 1000

function formatNorwegianDate(iso: string): string {
  return new Date(iso).toLocaleDateString('nb-NO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo',
  })
}

/**
 * Avgjør hva som skal skje når en bruker løser inn en kode. Dekker rad A–F i
 * beslutningstabellen:
 *
 *   A  ingen dekning          → start nå
 *   B  Founders-trial aktiv   → stables på trial-slutt, abonnementet pauses
 *   C  kode allerede aktiv    → avvis med dato
 *   D  betalt abonnement      → stables på periodeslutt, abonnementet pauses
 *   E  (håndteres i checkout, ikke her)
 *   F  org-medlemskap         → avvis, koden bevares
 *
 * B og D er bevisst ÉN regel: begge stabler fra slutten av den dekningen
 * abonnementet allerede gir, og pauser innkrevingen fram til kodens slutt. At
 * den ene er en trial og den andre er betalt endrer ingenting i utfallet.
 */
export function decideRedemption(
  state: PremiumState,
  durationDays: number | null,
  now: Date = new Date(),
): RedemptionDecision {
  // F — org dekker brukeren. De mister ingenting på å vente, og koden bevares.
  if (state.sources.org) {
    const names = state.sources.org.orgNames
    const via = names.length > 0 ? names.join(' og ') : 'bedriften din'
    return {
      action: 'reject',
      reason: 'org_covered',
      message: `Du har allerede Premium via ${via}. Koden er ikke brukt opp — ta vare på den til senere.`,
    }
  }

  // C — kun én aktiv kode om gangen.
  if (state.sources.code) {
    const until = state.sources.code.expiresAt
    return {
      action: 'reject',
      reason: 'code_active',
      message: until
        ? `Du har allerede en aktiv kode til ${formatNorwegianDate(until)}.`
        : 'Du har allerede en aktiv kode som gir Premium på ubestemt tid.',
    }
  }

  // B og D — stable oppå eksisterende abonnementsdekning.
  const sub = state.sources.stripe
  const existingEnd = sub ? stripeCoverageEnd(sub) : null
  const startsAt = existingEnd && new Date(existingEnd) > now
    ? new Date(existingEnd)
    : now

  const expiresAt = durationDays && durationDays > 0
    ? new Date(startsAt.getTime() + durationDays * DAY_MS)
    : null

  return {
    action: 'grant',
    startsAt: startsAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
    // Et levende abonnement skal ikke belastes for en periode brukeren
    // samtidig får gratis. Permanent kode → pause uten sluttdato.
    pause: sub
      ? { subscriptionId: sub.subscriptionId, resumesAt: expiresAt?.toISOString() ?? null }
      : null,
  }
}
