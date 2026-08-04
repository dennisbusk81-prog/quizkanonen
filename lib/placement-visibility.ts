// ── Hvilken plassering skal en spiller se på resultatflatene? ────────────────
// Ren logikk, uten I/O — testdekket i lib/placement-visibility.test.ts.
//
// Bedriftens valg (allow_global_league) avgjør om MULIGHETEN til å delta i den
// åpne konkurransen er åpen; den enkeltes valg (global_league_opt_out) avgjør
// om de faktisk deltar. En spiller som står utenfor — uansett hvilket av de to
// valgene som er årsaken — skal ikke få servert en offentlig plassering, for
// det er svaret på et spørsmål de (eller bedriften) har sagt de ikke stiller.
// De ser i stedet sin interne plassering («3. av 29 hos {orgName}»).
//
// Org-medlemmer som deltar åpent får BEGGE tall (internt + totalt).
//
// «unknown» finnes fordi myOrgs lastes asynkront (ProfileProvider):
// før /api/org/my-orgs har svart OK vet vi ikke om spilleren er blokkert, og
// da skal INGEN plassering vises — å anta «public» ville lekke det offentlige
// tallet til en blokkert ansatt i vinduet før svaret lander (samme invariant
// som myOrgsLoaded-regelen i ProfileProvider: feil/uavklart er «vet ikke»,
// aldri «ikke medlem»). Gjester (userId null) kan ikke være org-medlemmer og
// er alltid 'public' — de skal ikke miste plasseringsestimatet sitt på å
// vente på et org-svar som aldri kommer.

export type PlacementOrg = {
  orgSlug: string
  orgName: string
  allowGlobalLeague: boolean
  // null = ikke besvart, true = valgt seg ut, false = valgt seg inn
  globalLeagueOptOut: boolean | null
}

export type PlacementDisplay =
  | { mode: 'public'; org: null }
  | { mode: 'unknown'; org: null }
  | { mode: 'internal-only'; org: PlacementOrg }
  | { mode: 'both'; org: PlacementOrg }

export function decidePlacementDisplay(input: {
  userId: string | null
  orgsLoaded: boolean
  orgs: readonly PlacementOrg[]
}): PlacementDisplay {
  if (input.userId === null) return { mode: 'public', org: null }
  if (!input.orgsLoaded) return { mode: 'unknown', org: null }
  if (input.orgs.length === 0) return { mode: 'public', org: null }

  // Én blokkerende tilhørighet er nok — samme regel som sesongtopplistens
  // deriveBlockedFromLiveStatus (lib/global-league-visibility.ts): stengt org
  // ELLER eget opt-out. Ved flere medlemskap vinner den blokkerende orgen,
  // og den interne plasseringen vises for den.
  const blocking = input.orgs.find(
    o => o.allowGlobalLeague === false || o.globalLeagueOptOut === true
  )
  if (blocking) return { mode: 'internal-only', org: blocking }

  return { mode: 'both', org: input.orgs[0] }
}

// ── Gratis-plasseringskortet på /leaderboard/[id] ────────────────────────────
// «Du er et sted mellom plass X og Y» for innloggede gratisbrukere mens quizen
// er åpen. Vilkåret bor her — ikke inline i JSX — fordi det var nettopp dette
// kortet som ble glemt da de fire andre egen-plassering-flatene på siden fikk
// suppressOwnPublicRank-gaten (hero, persentil, delingstekst, «Gå til min
// plassering»): en blokkert gratisbruker fikk det OFFENTLIGE båndet her mens
// resultatskjermen viste det interne. Som ren funksjon kan gaten
// mutasjonstestes; en inline-betingelse kan ikke.
//
// suppressOwnPublicRank er sidens ferdig utregnede «skal eget offentlig tall
// holdes tilbake» (internal-only ELLER unknown, og aldri i ?org=-modus) — samme
// verdi som de fire andre flatene leser.
export function shouldShowFreePlacementCard(input: {
  authLoading: boolean
  hasSession: boolean
  isPremium: boolean
  isClosed: boolean
  hasPlayed: boolean
  totalCount: number
  suppressOwnPublicRank: boolean
}): boolean {
  if (input.authLoading || !input.hasSession) return false
  if (input.isPremium) return false            // Premium har hero-kortet med eksakt tall
  if (input.isClosed) return false             // etter stengt quiz står det endelige tallet i listen
  if (!input.hasPlayed) return false
  if (input.totalCount <= 0) return false
  if (input.suppressOwnPublicRank) return false
  return true
}
