// Sendekvote for org-invitasjoner (app/api/org/[slug]/send-invite).
//
// BAKGRUNN
// Ruten tillot 50 e-poster per kall, og en gratis trial-org kan opprettes uten
// kort på sekunder. Kombinasjonen gjorde Quizkanonen til et brukbart e-post-relé
// fra hei@quizkanonen.no — med risiko for at domenet svartelistes.
//
// HVORFOR IKKE «betaler = tillatt»
// Den ene ekte bedriftskunden (Elkjøp Nordic) står med subscription_status
// 'trialing' fram til trial-slutt. En grense basert på betalingsstatus alene
// ville rammet dem direkte. Vi bruker derfor to signaler som er dyre for en
// angriper og gratis for en ekte bedrift:
//
//   • ALDER — en spam-org er fersk
//   • ANTALL MEDLEMMER — mottakerne av spam melder seg aldri inn, så en
//     misbruks-org får aldri en reell medlemsmasse
//
// En ny, legitim bedrift havner i 'ny' de første dagene og kan fortsatt invitere
// 40 kolleger i døgnet — nok til å komme i gang, for lite til å være attraktivt
// som relé.

export type InviteTier = 'etablert' | 'ny'

export type InviteQuota = {
  tier: InviteTier
  perCall: number
  perDay: number
}

export const ESTABLISHED_MIN_AGE_DAYS = 7
export const ESTABLISHED_MIN_MEMBERS = 5

const QUOTAS: Record<InviteTier, { perCall: number; perDay: number }> = {
  // Uendret oppførsel for etablerte orger — 50 per kall som før.
  etablert: { perCall: 50, perDay: 200 },
  ny:       { perCall: 15, perDay: 40 },
}

export type InviteQuotaInput = {
  subscriptionStatus: string | null | undefined
  createdAt: string | null | undefined
  memberCount: number
  now?: Date
}

export function resolveInviteQuota({
  subscriptionStatus,
  createdAt,
  memberCount,
  now = new Date(),
}: InviteQuotaInput): InviteQuota {
  const createdMs = createdAt ? Date.parse(createdAt) : NaN
  const ageDays = Number.isNaN(createdMs)
    ? 0
    : (now.getTime() - createdMs) / 86_400_000

  const established =
    subscriptionStatus === 'active' ||
    (ageDays >= ESTABLISHED_MIN_AGE_DAYS && memberCount >= ESTABLISHED_MIN_MEMBERS)

  const tier: InviteTier = established ? 'etablert' : 'ny'
  return { tier, ...QUOTAS[tier] }
}
