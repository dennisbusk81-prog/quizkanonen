import { decideSubscriptionEntry, subscriptionMenuHref } from '@/lib/subscription-entry'

// ── Navigasjonsmodellen: HVA som står hvor, som rene data ───────────────────
//
// REN logikk, ingen React. components/NavAuth.tsx rendrer det denne fila
// returnerer; lib/nav-model.test.ts kjører nøyaktig samme funksjoner per
// brukertype. Før 6. september 2026 lå innholdet inline i JSX-en og kunne
// bare voktes med regex mot kildeteksten (lib/kontomeny-arkivlenke.test.ts,
// lib/navnepolicy-etiketter.test.ts) — de vaktene består, men innholdet per
// brukertype er nå en funksjon man kan kalle.
//
// ── MODELLEN (Dennis, 6. september 2026) ────────────────────────────────────
//   TOPPLINJEN   = de få viktigste: Spill · Toppliste · For bedrifter/
//                  bedriften · Quizarkiv. Fire lenker, aldri flere.
//   KONTOMENYEN  = alt annet, samlet ett sted, på alle bredder. Gruppert med
//                  tynne skillelinjer.
//   HAMBURGEREN  = finnes KUN for gjest, og kun under 899 px. En innlogget
//                  bruker har én meny: kontomenyen. To knapper ved siden av
//                  hverandre med samme innhold er ett sted til å lete, ikke
//                  ett sted færre.
//
// Ordbruken følger navnepolicyen fra 76c0c8a (ett ord per ting): Toppliste,
// Quizarkiv, Ligaer (ubestemt i nav, «Mine ligaer» er sidens H1),
// Bedriftspanel. «Bedriften» er hjemmet /org/[slug] — siden med «Forlat
// organisasjon» og låst-skjermen, som scope-bryteren på /toppliste ikke har.
// Både topplinjen og kontomenyen viser bedriftens NAVN (klemt til 110 px,
// samme klemme som avatar-navnet) — ett ord per ting, og navnet er ordet.
// «Bedriften» som fast etikett ble vurdert og forkastet 6. september: to
// etiketter for samme mål er den feilklassen navnerunden ryddet.
//
// ── «SPILL» ─────────────────────────────────────────────────────────────────
// Peker på den quizen som er ÅPEN NÅ (lib/active-quiz.ts, hentet i
// rot-layouten). Ingen åpen quiz → ingen lenke. En lenke som heter «Spill»
// og lander på en nedtelling er et løfte siden ikke kan holde. Og står
// brukeren allerede PÅ den quizens side, skjules lenken også — en lenke til
// siden man er på er støy, og på resultatskjermen etter én gjennomspilling
// ville den lovet en runde til.
//
// ── globalHidden ─────────────────────────────────────────────────────────────
// Et medlem i en bedrift som skjuler den nasjonale lista får ingen
// «Toppliste»-lenke — verken i topplinjen eller i kontomenyen. Uendret fra
// før: /toppliste velger alltid global uten URL-parameter
// (decideTopplisteScope), så hun ville landet på en liste hun er utestengt
// fra. Om lenken heller skal sende `?scope=organization&scope_id=…` for
// henne er en åpen beslutning (rapportert 6. september), ikke tatt her.

export interface NavOrg {
  orgId: string
  orgSlug: string
  orgName: string
  isAdmin: boolean
  allowGlobalLeague: boolean
}

export interface NavInput {
  loggedIn: boolean
  /** Id på quizen som er åpen nå, eller null. */
  activeQuizId: string | null
  /** Nåværende sti — brukes kun til å skjule «Spill» på quizens egen side. */
  pathname: string | null
  myOrgs: NavOrg[]
}

export interface NavLink {
  key: string
  label: string
  href: string
  /** Brukerskrevet tekst (org-navn) — rendres med orgNameClamp. */
  clamp?: boolean
}

export type AccountRow =
  | (NavLink & { kind: 'link'; badge?: 'premium' })
  | { kind: 'portal'; key: 'abonnement'; label: 'Abonnement' }

export interface AccountMenuInput extends NavInput {
  /** Profilen har landet — Quizhistorikk og Abonnement vises først da. */
  profileLoaded: boolean
  isPremium: boolean
  hasStripeCustomer: boolean
  hasUsedTrial: boolean
}

export function isGlobalHidden(myOrgs: ReadonlyArray<Pick<NavOrg, 'allowGlobalLeague'>>): boolean {
  return myOrgs.length > 0 && myOrgs.some(o => !o.allowGlobalLeague)
}

/** Målet for «Spill», eller null når lenken skal skjules. */
export function spillHref(activeQuizId: string | null, pathname: string | null): string | null {
  if (!activeQuizId) return null
  const href = `/quiz/${activeQuizId}`
  if (pathname === href) return null
  return href
}

const SPILL = (href: string): NavLink => ({ key: 'spill', label: 'Spill', href })
const TOPPLISTE: NavLink = { key: 'toppliste', label: 'Toppliste', href: '/toppliste' }
const FOR_BEDRIFTER: NavLink = { key: 'bedrifter', label: 'For bedrifter', href: '/bedrift' }
const QUIZARKIV: NavLink = { key: 'arkiv', label: 'Quizarkiv', href: '/arkiv' }
const LIGAER: NavLink = { key: 'ligaer', label: 'Ligaer', href: '/liga' }
const SLIK: NavLink = { key: 'slik', label: 'Slik fungerer det', href: '/slik-fungerer-det' }
const MIN_PROFIL: NavLink = { key: 'profil', label: 'Min profil', href: '/profil' }

/**
 * Topplinjen: Spill · Toppliste · For bedrifter/bedriften · Quizarkiv.
 * Samme fire slots for gjest og innlogget; slot 3 følger medlemskapet.
 * En bruker med flere bedrifter får den FØRSTE i topplinjen (én slot) og
 * alle i kontomenyen.
 */
export function topLinks(input: NavInput): NavLink[] {
  const ut: NavLink[] = []
  const spill = spillHref(input.activeQuizId, input.pathname)
  if (spill) ut.push(SPILL(spill))
  if (!(input.loggedIn && isGlobalHidden(input.myOrgs))) ut.push(TOPPLISTE)
  const org = input.loggedIn ? input.myOrgs[0] : undefined
  if (org) ut.push({ key: `org:${org.orgSlug}`, label: org.orgName, href: `/org/${org.orgSlug}`, clamp: true })
  else ut.push(FOR_BEDRIFTER)
  ut.push(QUIZARKIV)
  return ut
}

/**
 * Gjestens hamburger (kun under 899 px): topplinjens fire pluss det gjesten
 * ellers ikke har noen meny for. «Spill» står i tillegg FAST i topplinjen
 * for gjest også under 899 (NavAuth, TopLink alwaysVisible): en fremmed fra
 * en delt lenke skal se veien til quizen uten å åpne en meny. Målt behov
 * for den mobile raden med Spill: 326 px — får plass på 375 (49 px til
 * overs), ikke på 320 (6 px over). Den gamle «Spill nå →»-knappen trengte
 * 359 og godtok samme 320-overskridelse.
 */
export function guestMenuLinks(input: NavInput): NavLink[] {
  return [...topLinks({ ...input, loggedIn: false, myOrgs: [] }), LIGAER, SLIK]
}

/**
 * Kontomenyen for innlogget bruker, gruppe for gruppe. «Logg ut» er ikke
 * med — den er en handling med egen feilhåndtering, ikke en lenke, og
 * rendres av NavAuth etter siste gruppe.
 *
 *   1. Spill? · Toppliste · Quizarkiv · Ligaer · bedriftens navn/For
 *      bedrifter · Bedriftspanel
 *   2. Min profil · Quizhistorikk · Abonnement
 *   3. Slik fungerer det
 */
export function accountMenuGroups(input: AccountMenuInput): AccountRow[][] {
  const g1: AccountRow[] = []
  const spill = spillHref(input.activeQuizId, input.pathname)
  if (spill) g1.push({ kind: 'link', ...SPILL(spill) })
  if (!isGlobalHidden(input.myOrgs)) g1.push({ kind: 'link', ...TOPPLISTE })
  g1.push({ kind: 'link', ...QUIZARKIV })
  g1.push({ kind: 'link', ...LIGAER })
  if (input.myOrgs.length === 0) {
    g1.push({ kind: 'link', ...FOR_BEDRIFTER })
  } else {
    for (const org of input.myOrgs) {
      g1.push({ kind: 'link', key: `org:${org.orgSlug}`, label: org.orgName, href: `/org/${org.orgSlug}`, clamp: true })
    }
  }
  const adminOrgs = input.myOrgs.filter(o => o.isAdmin)
  for (const org of adminOrgs) {
    g1.push(adminOrgs.length === 1
      ? { kind: 'link', key: `admin:${org.orgSlug}`, label: 'Bedriftspanel', href: `/org/${org.orgSlug}/admin` }
      : { kind: 'link', key: `admin:${org.orgSlug}`, label: org.orgName, href: `/org/${org.orgSlug}/admin`, clamp: true })
  }

  const g2: AccountRow[] = [{ kind: 'link', ...MIN_PROFIL }]
  if (input.profileLoaded) {
    // Quizhistorikk er Premium-gatet: gratis sendes til /premium med badge.
    // Gaten på profileLoaded hindrer at en Premium-bruker ser låst variant i
    // blaffet før profilen har landet.
    g2.push(input.isPremium
      ? { kind: 'link', key: 'historikk', label: 'Quizhistorikk', href: '/historikk' }
      : { kind: 'link', key: 'historikk', label: 'Quizhistorikk', href: '/premium', badge: 'premium' })
    const entry = decideSubscriptionEntry(input)
    const href = subscriptionMenuHref(entry)
    g2.push(href === null
      ? { kind: 'portal', key: 'abonnement', label: 'Abonnement' }
      : { kind: 'link', key: 'abonnement', label: 'Abonnement', href })
  }

  const g3: AccountRow[] = [{ kind: 'link', ...SLIK }]
  return [g1, g2, g3]
}
