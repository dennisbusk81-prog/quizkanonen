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

// ── Når «vet ikke» aldri går over av seg selv ────────────────────────────────
// 'unknown' er riktig så lenge org-svaret fortsatt er underveis — det retter
// seg selv når svaret lander. Men ProfileProvider setter med vilje ALDRI
// `myOrgsLoaded` på et FEILET forsøk (et feilsvar er «vet ikke», aldri «ingen
// medlemskap»), og hverken resultatskjermen eller /leaderboard/[id] henter
// org-listen på nytt. Én feilet `/api/org/my-orgs` skjulte derfor spillerens
// egen plassering for resten av økta — på begge flatene, og nettopp i
// belønningsøyeblikket etter fullført quiz.
//
// Skillet vi trenger er altså ikke «vet vi det?» (det svarer
// decidePlacementDisplay på, og semantikken der står urørt), men «kan vi
// noensinne komme til å vite det uten at brukeren gjør noe?». `myOrgsError` er
// det signalet, og `refreshMyOrgs()` fra samme context er utveien —
// nøyaktig samme par som /org/[slug] sin feilskjerm allerede bruker.
//
// Bevisst en KNAPP og ikke et automatisk nytt forsøk: en automatisk retry på
// en rute som nettopp feilet er en ny mekanisme med egne vakter, og på
// quizkvelden er en stille retry-løkke mot et endepunkt under press verre enn
// en knapp brukeren trykker på når hen faktisk vil ha tallet.
export function shouldOfferPlacementRetry(input: {
  mode: PlacementDisplay['mode']
  myOrgsError: boolean
}): boolean {
  // KUN 'unknown'. 'internal-only' er et bekreftet svar — der ER det riktig at
  // det offentlige tallet mangler, og en «Prøv igjen» ville lovet at et nytt
  // forsøk kunne endre utfallet. 'public'/'both' viser allerede plasseringen.
  return input.mode === 'unknown' && input.myOrgsError
}

// ── HVORFOR står jeg ikke på den åpne topplisten? ────────────────────────────
// 'internal-only' har TO ulike årsaker, og en forklaringstekst som påstår feil
// årsak er verre enn ingen tekst: «bedriften din har valgt …» til en ansatt som
// selv slo det av er en usann påstand om arbeidsgiveren, og «du har valgt …»
// til en ansatt i en stengt org sender henne til en profilbryter som ikke kan
// endre utfallet (org-policyen overstyrer — se /api/org/[slug]/league-preference:
// opt-in gir ikke global synlighet når orgen har allow_global_league=false).
//
// Derfor vinner org-policyen når BEGGE er sanne: det er den som faktisk
// bestemmer utfallet, og den ansattes egen bryter er da uten effekt.
//
// Merk at `org` her er den samme raden decidePlacementDisplay() plukket ut
// (første blokkerende medlemskap) — ikke en ny kilde, så teksten kan ikke
// beskrive en annen org enn den plasseringstallet gjelder.
export type GlobalExclusionReason = 'org-policy' | 'own-choice'

export function globalExclusionReason(org: PlacementOrg): GlobalExclusionReason {
  return org.allowGlobalLeague === false ? 'org-policy' : 'own-choice'
}

// ── Gratis-plasseringskortet på /leaderboard/[id] ────────────────────────────
// «Du er et sted mellom plass X og Y» for innloggede gratisbrukere. Vilkåret
// bor her — ikke inline i JSX — fordi det var nettopp dette kortet som ble
// glemt da de fire andre egen-plassering-flatene på siden fikk
// suppressOwnPublicRank-gaten (hero, persentil, delingstekst, «Gå til min
// plassering»): en blokkert gratisbruker fikk det OFFENTLIGE båndet her mens
// resultatskjermen viste det interne. Som ren funksjon kan gaten
// mutasjonstestes; en inline-betingelse kan ikke.
//
// Spennet vises UANSETT om quizen er åpen eller stengt (P-1, 23. august 2026).
// Fram til da fjernet en isClosed-gate kortet ved stengetid, med begrunnelsen
// «det endelige tallet står i listen» — men gratis ser nå kun topp 10, så en
// gratisbruker utenfor topp 10 sto igjen uten NOE om egen plassering etter
// stenging. Det brøt løftet i /slik-fungerer-det, som eksplisitt lover
// «Estimert plassering» i gratis-kolonnen uten forbehold om åpen quiz.
//
// suppressOwnPublicRank er sidens ferdig utregnede «skal eget offentlig tall
// holdes tilbake» (internal-only ELLER unknown, og aldri i ?org=-modus) — samme
// verdi som de fire andre flatene leser.
export function shouldShowFreePlacementCard(input: {
  authLoading: boolean
  hasSession: boolean
  isPremium: boolean
  hasPlayed: boolean
  totalCount: number
  suppressOwnPublicRank: boolean
}): boolean {
  if (input.authLoading || !input.hasSession) return false
  if (input.isPremium) return false            // Premium har hero-kortet med eksakt tall
  if (!input.hasPlayed) return false
  if (input.totalCount <= 0) return false
  if (input.suppressOwnPublicRank) return false
  return true
}
