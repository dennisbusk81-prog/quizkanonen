// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// INTEGRASJONSTEST av den ekte GET /api/leaderboard/[id]. `mock.module` bytter
// ut supabase-admin, slik at både ruten, lib/ranking og lib/premium-check
// kjøres uendret — grace-perioden testes derfor mot den EKTE getUserPremium.
//
// SAKEN: eksakt plassering er en Premium-funksjon, men muren lå kun i klienten.
// Ruten sendte `userRank` (og hele raden med eksakt rank) til enhver innlogget
// bruker — lesbart i nettverksfanen for alle, uansett Premium-status.
//
// MUTASJONSBEVIS (alle kjørt):
//   • Fjernes `userIsPremium`-grenen (alltid eksakt)      → 4 tester ryker.
//   • Byttes grovmalingen til `mine.rank`                  → 2 tester ryker.
//   • Byttes getUserPremium tilbake til `premium_status === true` alene
//     → grace-testen ryker (brukeren i grace mister eksakt plassering).
//   • Fjernes raden helt for gratis (`userEntry = null`)   → 3 tester ryker
//     (score/tid/streak/antall spørsmål forsvinner for gratisbrukere).
//
// ── TILLEGG 2. august 2026: to beslektede hull i SAMME rute ──────────────────
// SAK 1: `hide_leaderboard_until_closed` ble håndhevet KUN i klienten. Ruten
//        leste aldri quizzes-tabellen, så hele stillingen på en åpen, skjult
//        quiz kunne hentes rått fra API-et.
// SAK 2: ?page=/?search= (Premium-funksjoner i UI-et) ble besvart for alle, så
//        en gratisbruker kunne bla seg fram til sin egen eksakte rad.
//
// MUTASJONSBEVIS for tillegget (alle kjørt, med målt antall):
//   • Fjernes `leaderboardHidden` fra `entries`-valget      → 7 tester ryker.
//   • Droppes `!quizIsClosed` (skjuler også stengte quizer) → 1 test ryker.
//   • Droppes Premium-unntaket `!(userIsPremium && !!mine)` → 1 test ryker.
//   • Fail-safe `!quizRow` byttes til «ikke skjult»         → 1 test ryker.
//   • Skjules også `userEntry`/`totalCount`                 → 1 test ryker
//     (svaret skal være redusert, ikke tomt — plasseringskortet lever av dem).
//   • Fjernes `userIsPremium` fra browse-gaten              → 3 tester ryker.
//   • Byttes browse-gaten til en 403 i stedet for å
//     ignorere parameterne                                  → 4 tester ryker.
//
// SAK 3 (samme feilklasse, lukket rett etter): `show_leaderboard = false` ble
//        også håndhevet kun i klienten — der er det en full tidlig retur av
//        HELE siden («Ukens resultater er ikke aktivert for denne quizen»).
//        Ruten leverte stillingen som normalt. Virkningen er identisk med sak 1
//        (entries tømmes), men BETINGELSEN er en annen: permanent, uten
//        tidsgrense og uten Premium-unntak.
//
// MUTASJONSBEVIS for sak 3 (alle kjørt, med målt antall):
//   • Ignoreres `show_leaderboard` helt                     → 8 tester ryker.
//   • Gis av-bryteren en tidsgrense (`&& !quizIsClosed`)    → 1 test ryker.
//   • Gis av-bryteren Premium-unntaket fra sak 1            → 2 tester ryker.
//   • Nulles også userEntry/userRank/totalCount ved av      → 2 tester ryker
//     (egen plassering er en annen funksjon enn den offentlige lista).
//   • Lar `until_closed` vinne over `disabled` i årsaken    → 1 test ryker.
//
// SAK 4 (3. august 2026, samme feilklasse igjen): `guestRank` ble regnet ut fra
//        de SAMME radene som skjulingen holdt tilbake, uten å se på
//        `leaderboardHidden`. `entries` ble tømt, men en uinnlogget kaller
//        kunne sende ?my_correct=&my_time= og få sin EKSAKTE plass i en skjult
//        stilling. Gaten var satt på hovedstien; denne sideveien rundt var det
//        ikke. Funnet ved å verifisere at sak 1–3 faktisk var lukket.
//
// MUTASJONSBEVIS for sak 4 (alle kjørt, med målt antall):
//   • Fjernes `!leaderboardHidden` fra guest-grenen (den
//     naive implementasjonen som sto der før)              → 5 tester ryker.
//   • Gates det kun på `hiddenReason === 'until_closed'`   → 2 tester ryker
//     (den permanente av-bryteren ville lekket).
//   • Skjules OGSÅ egen rad (`if (mine && !leaderboardHidden)`,
//     en for bred «skjul alt»-fiks)                        → 4 tester ryker.
//
// Merk metoden i «LEKKASJEBEVIS»-testen: den positive kontrollen kjøres FØRST,
// på samme fixture og samme spørrestreng, og fastslår at plasseringen er 13.
// Uten den ville `null` i den skjulte grenen ikke bevist noe — en tom fixture
// eller en feilstavet parameter gir samme null uten at gaten er involvert.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ME = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'

const OM_EN_TIME = () => new Date(Date.now() + 3_600_000).toISOString()
const FOR_EN_TIME_SIDEN = () => new Date(Date.now() - 3_600_000).toISOString()

type AttemptRow = {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  is_team: boolean
  team_size: number
  leader_display_name: string | null
  submitted_at: string | null
  quiz_id: string
}

type QuizRow = {
  closes_at: string | null
  hide_leaderboard_until_closed: boolean
  show_leaderboard: boolean
}

/** Standard: en vanlig, åpen quiz med leaderboard PÅ og ingen skjuling. */
function quizRow(overrides: Partial<QuizRow> = {}): QuizRow {
  return {
    closes_at: OM_EN_TIME(),
    hide_leaderboard_until_closed: false,
    show_leaderboard: true,
    ...overrides,
  }
}

const state: {
  attempts: AttemptRow[]
  profile: { premium_status: boolean; org_premium_grace_until: string | null }
  /** null = ruten finner ingen quiz-rad (fail-safe-stien). */
  quiz: QuizRow | null
  /** true = organisasjons-oppslagene i lib/globally-blocked-set feiler. */
  orgLookupsThrow: boolean
  /** true = selve premium-oppslaget i lib/premium-check feiler. */
  premiumLookupFails: boolean
  /** true = kallenavn-oppslaget (profiles .in) feiler. */
  nicknameLookupFails: boolean
  /**
   * null = ingen bedrift finnes (grunntilstanden for denne filen). Ellers en
   * org med `slug` og `memberIds` — nødvendig for å teste ?org= i det hele
   * tatt: uten en ekte medlemsliste ville `memberIdSet` blitt tom,
   * `scopedRows` tom, og `entries` tom UANSETT om org-gaten sto der eller ei.
   * En slik test er grønn av feil grunn og feller ingen mutasjon.
   */
  org: { slug: string; memberIds: string[] } | null
} = {
  attempts: [],
  profile: { premium_status: false, org_premium_grace_until: null },
  quiz: null,
  orgLookupsThrow: false,
  premiumLookupFails: false,
  nicknameLookupFails: false,
  org: null,
}

/** Et innsendt solo-forsøk. Færre riktige = dårligere plassering. */
function attempt(n: number, correct: number, userId: string | null = null): AttemptRow {
  return {
    id: `attempt-${n}`,
    user_id: userId,
    player_name: userId ? 'Meg Megsen' : `Spiller ${n}`,
    correct_answers: correct,
    total_questions: 15,
    total_time_ms: 30_000 + n,
    correct_streak: userId ? 4 : 1,
    is_team: false,
    team_size: 1,
    leader_display_name: null,
    submitted_at: '2026-08-01T10:00:00.000Z',
    quiz_id: QUIZ,
  }
}

// Minimal PostgREST-etterligning. To ulike spørringer mot `profiles`:
// premium-oppslaget (maybeSingle) og nickname-oppslaget (.in, await). I tillegg
// ett oppslag mot `quizzes` (maybeSingle) for skjult-leaderboard-gaten.
//
// `order`/`range` MÅ finnes: ruten kaller den EKTE lib/globally-blocked-set
// (kun supabase-admin er mocket her), og den paginerer med fetchAllRows.
// Manglet de, kastet lib-en — og fail-safe-stien (5. august 2026, funn F2)
// skjulte da samtlige spillere, slik at hver eneste test i denne filen målte
// fail-safe i stedet for det den faktisk handler om. Se
// «FAIL-SAFE mot org-oppslaget» nederst for den bevisste versjonen av det.
//
// `organizations` og `organization_members` er TOMME så lenge `state.org` er
// null — ingen bedrift har skrudd av global liga i disse fixturene, som er
// riktig grunntilstand for en fil som handler om Premium-gating.
//
// Settes `state.org`, svarer de med ekte rader, og FILTRENE ANVENDES (29.
// august 2026). Begge deler er nødvendig:
//   • Ekte rader, fordi resolveOrgMembership ellers ikke slipper kalleren inn
//     og ?org=-testene aldri når gaten de handler om.
//   • Filtrene, fordi lib/globally-blocked-set spør SAMME to tabeller på den
//     nasjonale stien (`allow_global_league = false`,
//     `global_league_opt_out = true`). Fixtur-org-en settes med begge feltene
//     i «ikke blokkert»-stilling, så den faller ut av de spørringene og kan
//     ikke smitte over på de nasjonale testene.
function orgRows(table: string): Record<string, unknown>[] {
  if (!state.org) return []
  if (table === 'organizations') {
    return [{ id: ORG, slug: state.org.slug, allow_global_league: true }]
  }
  return state.org.memberIds.map(uid => ({
    user_id: uid,
    organization_id: ORG,
    role: 'member',
    global_league_opt_out: false,
  }))
}

function builder(table: string, orgLookupsThrow: boolean) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = []

  const b: Record<string, unknown> = {
    select() { return b },
    eq(col: string, val: unknown) { filters.push(r => r[col] === val); return b },
    in(col: string, vals: unknown[]) { filters.push(r => vals.includes(r[col])); return b },
    limit() { return b },
    order() { return b },
    range() { return b },
    maybeSingle() {
      if (table === 'quizzes') return Promise.resolve({ data: state.quiz, error: null })
      if (table === 'organizations' || table === 'organization_members') {
        if (orgLookupsThrow) {
          return Promise.resolve({ data: null, error: { message: 'simulert DB-feil' } })
        }
        let out = orgRows(table)
        for (const f of filters) out = out.filter(f)
        return Promise.resolve({ data: out[0] ?? null, error: null })
      }
      // Ellers: premium-oppslaget i lib/premium-check.
      if (state.premiumLookupFails) {
        return Promise.resolve({ data: null, error: { message: 'simulert DB-feil' } })
      }
      return Promise.resolve({ data: state.profile, error: null })
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'attempts') {
        let out = state.attempts as unknown as Record<string, unknown>[]
        for (const f of filters) out = out.filter(f)
        return resolve({ data: out, error: null })
      }
      if (table === 'organizations' || table === 'organization_members') {
        if (orgLookupsThrow) {
          return resolve({ data: null, error: { message: 'simulert DB-feil' } })
        }
        let out = orgRows(table)
        for (const f of filters) out = out.filter(f)
        return resolve({ data: out, error: null })
      }
      // profiles → nickname-oppslaget
      if (state.nicknameLookupFails) {
        return resolve({ data: null, error: { message: 'simulert DB-feil' } })
      }
      return resolve({ data: [{ id: ME, nickname: null }], error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => ({ data: { user: { id: ME } }, error: null }),
      },
      from: (table: string) => builder(table, state.orgLookupsThrow),
    },
  },
})

const { GET } = await import('@/app/api/leaderboard/[id]/route')

type Svar = {
  entries: { rank: number; playerName: string }[]
  userRank: number | null
  guestRank: number | null
  userEntry: {
    rank: number
    correctAnswers: number
    totalQuestions: number
    totalTimeMs: number
    correctStreak: number | null
  } | null
  totalCount: number
  userIsPremium: boolean
  leaderboardHidden: boolean
  hiddenReason: 'disabled' | 'until_closed' | null
  page: number
  pageSize: number
}

/** `query` er alt etter `?`. Uten Authorization-header hvis `anonym`. */
async function hent(query = 'is_team=false&limit=1', anonym = false): Promise<Svar> {
  const request = new Request(`https://quizkanonen.no/api/leaderboard/${QUIZ}?${query}`, {
    headers: anonym ? {} : { authorization: 'Bearer test-token' },
  })
  const res = await GET(request as never, { params: Promise.resolve({ id: QUIZ }) })
  return res.json() as Promise<Svar>
}

const hentLeaderboard = () => hent()

/** Gjør meg til Premium (vanlig, betalt — ikke grace). */
function gjørMegPremium() {
  state.profile = { premium_status: true, org_premium_grace_until: null }
}

beforeEach(() => {
  // 20 spillere. Meg = 12. beste resultat (11 foran meg med flere riktige).
  state.attempts = [
    ...Array.from({ length: 11 }, (_, i) => attempt(i + 1, 15 - i)),
    attempt(12, 4, ME),
    ...Array.from({ length: 8 }, (_, i) => attempt(i + 13, 3 - i * 0)),
  ]
  state.profile = { premium_status: false, org_premium_grace_until: null }
  // Standard: en helt vanlig, åpen quiz uten skjult leaderboard.
  state.quiz = quizRow()
  state.orgLookupsThrow = false
  state.premiumLookupFails = false
  state.nicknameLookupFails = false
  state.org = null
})

// Kallenavn-oppslaget er personvern, ikke pynt: et kallenavn finnes gjerne
// nettopp fordi spilleren IKKE vil ha det ekte navnet sitt på en offentlig
// liste. Et tomt kart er «vet ikke», og degraderingen ville publisert de ekte
// navnene uten at noen la merke til det.
test('FEILET kallenavn-oppslag gir 503 — ekte navn skal ikke lekke i stedet', async () => {
  state.nicknameLookupFails = true

  const request = new Request(`https://quizkanonen.no/api/leaderboard/${QUIZ}?is_team=false&limit=1`, {
    headers: { authorization: 'Bearer test-token' },
  })
  const res = await GET(request as never, { params: Promise.resolve({ id: QUIZ }) })

  assert.equal(res.status, 503)
  const json = await res.json() as { entries?: unknown[]; error?: string }
  assert.equal(json.entries, undefined, 'ingen liste skal sendes ut uten kallenavnene')
  assert.ok(json.error)
})

// ── «Vet ikke» er ikke «ikke Premium» (19. august 2026) ───────────────────────
// lib/premium-check leste tidligere aldri `error`. En transient DB-feil ga
// `data: null`, og `data?.premium_status === true` gjorde det til `false` —
// altså gratisvisningen, servert til en betalende kunde uten feilmelding,
// uten logg og uten noe som skilte det fra et utløpt abonnement.
test('FEILET premium-oppslag gir 503 — ikke en stille nedgradering til gratis', async () => {
  state.profile = { premium_status: true, org_premium_grace_until: null }
  state.premiumLookupFails = true

  const request = new Request(`https://quizkanonen.no/api/leaderboard/${QUIZ}?is_team=false&limit=1`, {
    headers: { authorization: 'Bearer test-token' },
  })
  const res = await GET(request as never, { params: Promise.resolve({ id: QUIZ }) })

  assert.equal(res.status, 503, 'et forbigående svar, ikke en dom')
  const json = await res.json() as { userIsPremium?: boolean; error?: string }
  assert.equal(json.userIsPremium, undefined, 'ingen påstand om Premium-status skal sendes')
  assert.ok(json.error, 'feilen skal være synlig for klienten')
})

test('utlogget kaller berøres IKKE av premium-vakten', async () => {
  // Gaten står kun for innloggede — en anonym kaller gjør ikke oppslaget i det
  // hele tatt, og skal derfor få leaderboardet som før selv når profiles svikter.
  state.premiumLookupFails = true

  const svar = await hent('is_team=false&limit=1', true)

  assert.equal(svar.userIsPremium, false)
  assert.equal(svar.totalCount, 20, 'listen skal leveres som normalt')
})

test('PREMIUM: får eksakt plassering — både userRank og rank i raden', async () => {
  state.profile = { premium_status: true, org_premium_grace_until: null }

  const svar = await hentLeaderboard()

  assert.equal(svar.userIsPremium, true)
  assert.equal(svar.userRank, 12, 'Premium skal få det eksakte tallet')
  assert.equal(svar.userEntry?.rank, 12, 'raden skal også ha eksakt rank')
})

test('GRATIS: userRank utelates helt fra svaret', async () => {
  const svar = await hentLeaderboard()

  assert.equal(svar.userIsPremium, false)
  assert.equal(svar.userRank, null, 'det eksakte tallet skal ikke finnes i svaret')
})

test('GRATIS: rank i raden er grovmalt til 10-båndets start, ikke eksakt', async () => {
  const svar = await hentLeaderboard()

  // Eksakt rank er 12 → båndet er 11–20 → 11 er alt gratis-visningen trenger.
  assert.equal(svar.userEntry?.rank, 11, 'skal være båndstart, ikke 12')
  assert.notEqual(svar.userEntry?.rank, 12, 'eksakt rank skal ikke lekke via raden')
})

test('GRATIS: beholder sine egne resultattall (score, tid, streak)', async () => {
  // Raden er ikke Premium-data — resultatkortet viser disse til gratisbrukere,
  // og er eneste kilde når de spilte på en annen enhet.
  const svar = await hentLeaderboard()

  assert.equal(svar.userEntry?.correctAnswers, 4)
  assert.equal(svar.userEntry?.totalQuestions, 15)
  assert.equal(svar.userEntry?.correctStreak, 4)
  assert.ok((svar.userEntry?.totalTimeMs ?? 0) > 0)
})

test('GRACE etter tapt org-Premium teller som Premium (samme sjekk som resten)', async () => {
  // premium_status er false, men grace-perioden løper ennå. Den lokale
  // `premium_status === true`-spørringen ruten hadde før ville nektet her.
  state.profile = {
    premium_status: false,
    org_premium_grace_until: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  }

  const svar = await hentLeaderboard()

  assert.equal(svar.userIsPremium, true, 'grace skal telle som Premium')
  assert.equal(svar.userRank, 12, 'og gi eksakt plassering')
})

test('UTLØPT grace gir ikke Premium', async () => {
  state.profile = {
    premium_status: false,
    org_premium_grace_until: new Date(Date.now() - 86_400_000).toISOString(),
  }

  const svar = await hentLeaderboard()

  assert.equal(svar.userIsPremium, false)
  assert.equal(svar.userRank, null)
})

test('rank 1–10 grovmales til 1 (ingen bånd-start på 0 eller negativt)', async () => {
  // Meg på 3. plass → båndet er 1–10.
  state.attempts = [attempt(1, 15), attempt(2, 14), attempt(3, 13, ME), attempt(4, 12)]

  const svar = await hentLeaderboard()

  assert.equal(svar.userEntry?.rank, 1)
})

// ── SAK 1: hide_leaderboard_until_closed ────────────────────────────────────
// Gaten er den samme regelen som klientens `isHidden`:
//   skjult = hide_leaderboard_until_closed && quizen er ÅPEN && !viewerHasOwnRow
// «Åpen» avgjøres av den delte isQuizClosed() mot closes_at — samme signal som
// /api/quiz/[id]/standings, ikke et nytt.
//
// ── ENDRET 29. august 2026: Premium-leddet falt bort nasjonalt ──────────────
// `viewerHasOwnRow` var `userIsPremium && !!mine`; den er nå
// `!!mine && (!orgSlug || userIsPremium)`. Flagget skal hindre at noen ser
// stillingen FØR de spiller — den som HAR levert er ferdig, forsøket er låst,
// og trappen (P-1) gir innlogget gratis topp 10. Premium-leddet gjorde en
// betalingsvegg av en integritetsregel.
//
// Standardkalleren i denne filen (`hent()` uten `gjørMegPremium`) er nettopp
// den brukeren: innlogget, gratis, med et innsendt forsøk på plass 12. To
// tester her målte derfor tidligere at HUN fikk tom liste. De er snudd, ikke
// slettet — den gamle assertionen er beholdt som ny, motsatt påstand, slik at
// det står i historikken hva som faktisk endret seg.
//
// MUTASJONSBEVIS for endringen — MÅLT 29. august 2026, ikke anslått. Hver
// mutasjon ble verifisert med `git diff` i fila før tallet ble lest av:
//   • `userIsPremium &&` satt tilbake foran `!!mine`      → 1 test ryker
//     («GRATIS som HAR spilt får topp 10»). Bevisst ETT drap og ikke flere:
//     de øvrige skjul-testene er skrevet om til kallere som IKKE løfter
//     skjulingen, nettopp for å måle gaten og ikke standardkalleren.
//   • `(!orgSlug || userIsPremium)` fjernet helt          → 2 tester ryker
//     (org-medlemmet uten Premium ville fått HELE org-listen).
//   • `!orgSlug` alene i stedet for hele leddet           → 1 test ryker
//     (ville tatt løftet fra Premium i org-modus — utvidelsen skal legge til
//     en gruppe, ikke bytte ut en).
//
// Klientsiden har sine egne tre mutasjoner, felt i
// lib/leaderboard-visibility.test.ts — de kan ikke felles herfra.

test('SKJULT + ÅPEN: GRATIS som HAR spilt får topp 10 — trappen, ikke tom luft', async () => {
  // Den snudde testen. Fram til 29. august 2026 assertet denne `entries: []`
  // for nøyaktig denne kalleren (innlogget, gratis, forsøk på plass 12).
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, false, 'egen innsendt rad løfter skjulingen')
  // 10, ikke 20 og ikke 50: trappen (P-1) klemmer gratis til FREE_TOP. At
  // skjulingen løftes betyr topp 10, ikke hele feltet — de to gatene er
  // uavhengige, og denne assertionen er det som skiller dem.
  assert.equal(svar.entries.length, 10)
  assert.equal(svar.entries[0].rank, 1, 'listen starter på toppen av feltet')
})

test('SKJULT + ÅPEN: gratis som IKKE har spilt får fortsatt null rader', async () => {
  // Kontrollen som gjør testen over til et bevis på «har spilt» og ikke bare
  // på «er innlogget». Samme kaller, eneste forskjell er det egne forsøket.
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })
  state.attempts = state.attempts.filter(a => a.user_id !== ME)

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, true)
  assert.deepEqual(svar.entries, [], 'stillingen skal ikke kunne hentes rått før man har spilt')
})

test('SKJULT + ÅPEN: gratis med et IKKE-INNSENDT forsøk får null rader', async () => {
  // Søsken til premium-varianten lenger nede. Å bare STARTE quizen skal ikke
  // låse opp stillingen — ellers ville `start-attempt` alene vært nøkkelen,
  // og da holder flagget ingenting tilbake i det hele tatt.
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })
  state.attempts = state.attempts.map(a => a.user_id === ME ? { ...a, submitted_at: null } : a)

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, true)
  assert.equal(svar.entries.length, 0)
})

test('SKJULT + ÅPEN: også en uinnlogget klient får null rader', async () => {
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })

  const svar = await hent('is_team=false&limit=50', true)

  assert.equal(svar.entries.length, 0)
})

test('SKJULT + ÅPEN: svaret er REDUSERT, ikke tomt — eget resultat og totalCount står igjen', async () => {
  // Resultatskjermen i app/quiz/[id] og plasseringskortet på leaderboard-siden
  // kaller ruten nettopp mens quizen er åpen. Derfor ingen 403 og ingen blank
  // respons: spilleren skal få SITT eget, bare ikke andres.
  //
  // Kalleren er byttet 29. august 2026. Standardkalleren — gratis MED forsøk —
  // sto her før, men hun er ikke lenger skjult for. Påstanden er derfor delt i
  // to, fordi ingen ÉN kaller lenger bærer begge halvdelene: den som er skjult
  // for uten å ha spilt har heller ingen egen rad å bevare. Denne holder på
  // totalCount (Premium uten forsøk), den neste på userEntry (org-medlem med
  // forsøk).
  gjørMegPremium()
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })
  state.attempts = state.attempts.filter(a => a.user_id !== ME)

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.entries.length, 0, 'andres rader holdes tilbake')
  assert.equal(svar.totalCount, 19, 'totalCount står igjen — spennet regnes ut fra det')
})

// ── ORG-SCOPET beholder DAGENS regel (29. august 2026) ──────────────────────
// Utvidelsen gjelder kun nasjonal sti. Org-rommet har med vilje ingen trapp
// (`tierCap` er null der), så et rent `!!mine` ville gitt et gratis org-medlem
// HELE org-listen i det åpne vinduet. Det er en annen, større endring enn den
// bestilte — og på den ene flaten med en betalende B2B-kunde.
//
// De to testene under er et PAR, og må leses sammen: den første feller
// «org-leddet fjernet», den andre feller «org-leddet skrevet som `!orgSlug`
// alene». Kun én av dem ville sluppet den motsatte feilen gjennom.
//
// MERK fixturen: `state.org.memberIds` MÅ inneholde flere enn ME. Med bare ME
// i org-en ville `entries` inneholdt maksimalt kallerens egen rad, og testen
// vært grønn uansett om gaten sto der — det er ikke andres rader den da måler.
const ANDRE_1 = '33333333-3333-4333-8333-333333333333'
const ANDRE_2 = '44444444-4444-4444-8444-444444444444'

/** Gjør de to første fixture-forsøkene til navngitte org-kolleger. */
function medOrgKolleger() {
  state.attempts = state.attempts.map(a =>
    a.id === 'attempt-1' ? { ...a, user_id: ANDRE_1 }
    : a.id === 'attempt-2' ? { ...a, user_id: ANDRE_2 }
    : a
  )
  state.org = { slug: 'elkjop', memberIds: [ME, ANDRE_1, ANDRE_2] }
}

test('SKJULT + ÅPEN i ORG: gratis medlem som HAR spilt får IKKE org-listen', async () => {
  medOrgKolleger()
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })

  const svar = await hent('is_team=false&limit=50&org=elkjop')

  assert.equal(svar.leaderboardHidden, true, 'org-rommet beholder dagens regel')
  assert.equal(svar.entries.length, 0)
  // Den positive kontrollen, på SAMME fixtur og samme spørrestreng: uten den
  // beviser 0 ovenfor ingenting — en tom medlemsliste eller en feilstavet slug
  // gir samme null uten at gaten er involvert i det hele tatt.
  state.quiz = quizRow({ hide_leaderboard_until_closed: false })
  const synlig = await hent('is_team=false&limit=50&org=elkjop')
  assert.equal(synlig.entries.length, 3, 'org-listen er 3 rader når den IKKE er skjult')
})

test('SKJULT + ÅPEN i ORG: PREMIUM-medlem som har spilt får listen — uendret', async () => {
  // Regresjonsvakten mot en for smal org-gate. Skrives leddet som `!orgSlug`
  // alene i stedet for `(!orgSlug || userIsPremium)`, TAR utvidelsen løftet
  // fra en gruppe som har det i dag. Den skal legge til en gruppe, ikke bytte
  // ut en.
  medOrgKolleger()
  gjørMegPremium()
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })

  const svar = await hent('is_team=false&limit=50&org=elkjop')

  assert.equal(svar.leaderboardHidden, false)
  assert.equal(svar.entries.length, 3, 'org-rommet har ingen trapp — Premium ser alle medlemmene')
})

test('SKJULT + ÅPEN i ORG: egen rad står igjen for et gratis medlem', async () => {
  // Den andre halvdelen av påstanden over, på den flaten der en skjult
  // stilling FORTSATT kan sammenfalle med at kalleren har en egen rad:
  // org-rommet, der gratis-medlemmet ikke løfter skjulingen. Svaret skal være
  // redusert, ikke tomt — plasseringskortet lever av userEntry og totalCount.
  state.org = { slug: 'elkjop', memberIds: [ME] }
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })

  const svar = await hent('is_team=false&limit=50&org=elkjop')

  assert.equal(svar.entries.length, 0)
  assert.ok(svar.userEntry, 'brukerens egen rad skal overleve skjulingen')
  assert.equal(svar.userEntry?.correctAnswers, 4)
  assert.equal(svar.userEntry?.rank, 1, 'alene blant org-medlemmene i fixturen')
  assert.equal(svar.totalCount, 1)
})

test('SKJULT + STENGT quiz: listen er tilbake (skjulingen gjelder kun mens quizen er åpen)', async () => {
  state.quiz = quizRow({ closes_at: FOR_EN_TIME_SIDEN(), hide_leaderboard_until_closed: true })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, false)
  // 10, ikke 20: kalleren er gratis, og trappen (P-1) klemmer klassisk visning
  // til topp 10 for gratis — se egen seksjon nederst.
  assert.equal(svar.entries.length, 10)
})

test('SKJULT + ÅPEN: Premium som HAR spilt får listen — samme unntak som klienten', async () => {
  gjørMegPremium()
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, false)
  assert.equal(svar.entries.length, 20)
})

test('SKJULT + ÅPEN: Premium som IKKE har spilt får fortsatt null rader', async () => {
  gjørMegPremium()
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })
  // Fjern mitt forsøk — Premium alene løfter ikke skjulingen.
  state.attempts = state.attempts.filter(a => a.user_id !== ME)

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, true)
  assert.equal(svar.entries.length, 0)
})

test('SKJULT + ÅPEN: et ikke-innsendt forsøk teller ikke som «har spilt»', async () => {
  gjørMegPremium()
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })
  state.attempts = state.attempts.map(a => a.user_id === ME ? { ...a, submitted_at: null } : a)

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.entries.length, 0, 'å bare starte quizen skal ikke låse opp stillingen')
})

test('FAIL-SAFE: uten lesbar quiz-rad regnes leaderboardet som skjult', async () => {
  // En blipp mot databasen skal ikke kunne åpne en skjult stilling.
  state.quiz = null

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, true)
  assert.equal(svar.entries.length, 0)
})

test('IKKE skjult + åpen quiz: listen leveres som før (ingen regresjon)', async () => {
  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, false)
  assert.equal(svar.entries.length, 10, 'gratis-trinnet i trappen: topp 10')
})

// ── SAK 2: ?page= og ?search= er Premium ────────────────────────────────────
// Ikke-Premium får ikke en feil — parameterne ignoreres, og svaret blir det
// samme som uten dem.

test('GRATIS: ?page=2 ignoreres — samme svar som uten parameteren', async () => {
  const uten = await hent('is_team=false&limit=50')
  const med = await hent('is_team=false&limit=50&page=2')

  assert.equal(med.page, 1, 'siden skal falle tilbake til 1, ikke 2')
  assert.equal(med.pageSize, 10, 'gratis-trinnet (10), ikke browse-sidestørrelsen (20) eller limit (50)')
  assert.deepEqual(
    med.entries.map(e => e.rank),
    uten.entries.map(e => e.rank),
    'en gratisbruker skal ikke kunne bla seg forbi topplista',
  )
})

test('GRATIS: ?page= gir ikke tilgang til rader utenfor den klassiske grensen', async () => {
  // Uten gate ville side 2 (20/side) gitt radene 21–40. Med limit=10 stopper
  // gratisbrukeren på de ti første, uansett hvilken side de ber om.
  const svar = await hent('is_team=false&limit=10&page=3')

  assert.equal(svar.entries.length, 10)
  assert.equal(svar.entries[0]?.rank, 1, 'skal alltid starte på toppen')
})

test('GRATIS: ?search= ignoreres — verken rader eller totalCount filtreres', async () => {
  const svar = await hent('is_team=false&limit=50&search=Meg')

  assert.equal(svar.entries.length, 10, 'søket skal ikke isolere en enkelt rad (gratis-trinnet: 10)')
  assert.equal(svar.totalCount, 20, 'totalCount skal ikke avsløre treffantallet')
})

test('GRATIS: ?search= gir ingen feil, bare ingen ekstra data', async () => {
  // En klient som spør i god tro skal ikke få en ny feilsti å håndtere.
  const request = new Request(
    `https://quizkanonen.no/api/leaderboard/${QUIZ}?is_team=false&search=Meg&page=2`,
    { headers: { authorization: 'Bearer test-token' } },
  )
  const res = await GET(request as never, { params: Promise.resolve({ id: QUIZ }) })

  assert.equal(res.status, 200)
})

test('PREMIUM: ?search= virker fortsatt (ingen regresjon)', async () => {
  gjørMegPremium()

  const svar = await hent('is_team=false&limit=50&search=Meg')

  assert.equal(svar.entries.length, 1)
  assert.equal(svar.entries[0]?.playerName, 'Meg Megsen')
  assert.equal(svar.totalCount, 1, 'treffantallet er Premium-data og skal komme fram')
})

test('PREMIUM: ?page=2 virker fortsatt og gir side to (20/side)', async () => {
  gjørMegPremium()
  // 30 spillere → side 1 = rang 1–20, side 2 = rang 21–30.
  state.attempts = Array.from({ length: 30 }, (_, i) => attempt(i + 1, 30 - i))

  const svar = await hent('is_team=false&page=2')

  assert.equal(svar.page, 2)
  assert.equal(svar.pageSize, 20)
  assert.equal(svar.entries.length, 10)
  assert.equal(svar.entries[0]?.rank, 21)
})

test('GRACE etter tapt org-Premium gir også bla og søk', async () => {
  // Binder browse-gaten til den samme getUserPremium som resten av ruten —
  // en lokal `premium_status === true` ville tatt fra brukeren i grace.
  state.profile = {
    premium_status: false,
    org_premium_grace_until: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  }

  const svar = await hent('is_team=false&limit=50&search=Meg')

  assert.equal(svar.userIsPremium, true)
  assert.equal(svar.entries.length, 1, 'grace skal gi samme søk som betalt Premium')
})

test('SKJULT + ÅPEN slår ut bla/søk selv for Premium uten spilt forsøk', async () => {
  gjørMegPremium()
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })
  state.attempts = state.attempts.filter(a => a.user_id !== ME)

  const svar = await hent('is_team=false&search=Spiller')

  assert.equal(svar.entries.length, 0, 'søk skal ikke være en vei rundt skjulingen')
})

// ── SAK 3: show_leaderboard = false ─────────────────────────────────────────
// Samme VIRKNING som sak 1 (entries tømmes), men en annen BETINGELSE:
// permanent, uten tidsgrense og uten Premium-unntak. Testene under fastholder
// nettopp den forskjellen — det er den som gjør at de to ikke kan slås sammen
// til én betingelse, bare til ett utfall.

test('AV: show_leaderboard=false tømmer entries', async () => {
  state.quiz = quizRow({ show_leaderboard: false })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, true)
  assert.deepEqual(svar.entries, [], 'en deaktivert stilling skal ikke kunne hentes fra API-et')
})

test('AV: gjelder også når quizen er STENGT — i motsetning til hide_until_closed', async () => {
  // Dette er kjerneforskjellen mellom de to innstillingene. At quizen stenger
  // løfter hide_leaderboard_until_closed, men ikke show_leaderboard=false.
  state.quiz = quizRow({ closes_at: FOR_EN_TIME_SIDEN(), show_leaderboard: false })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, true)
  assert.equal(svar.entries.length, 0, 'stengetid skal ikke skru på en deaktivert stilling')
})

test('AV: gjelder også Premium som HAR spilt — ingen unntak', async () => {
  // Det andre som skiller dem: Premium-unntaket løfter hide_until_closed,
  // men skal ikke kunne løfte en deaktivert stilling.
  gjørMegPremium()
  state.quiz = quizRow({ show_leaderboard: false })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.entries.length, 0, 'Premium skal ikke være en vei rundt av-bryteren')
})

test('AV: også uinnlogget får null rader', async () => {
  state.quiz = quizRow({ show_leaderboard: false })

  const svar = await hent('is_team=false&limit=50', true)

  assert.equal(svar.entries.length, 0)
})

test('AV: brukerens EGET resultat rammes ikke — kun den offentlige lista', async () => {
  // Resultatskjermen etter en spilt quiz viser plasseringen sin uavhengig av
  // show_leaderboard (den er gated på show_live_placement, et eget felt), og
  // henter den herfra når /standings ikke svarer.
  state.quiz = quizRow({ show_leaderboard: false })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.entries.length, 0)
  assert.ok(svar.userEntry, 'egen rad skal overleve')
  assert.equal(svar.userEntry?.correctAnswers, 4)
  assert.equal(svar.userEntry?.rank, 11, 'fortsatt grovmalt bånd-start for gratis')
  assert.equal(svar.totalCount, 20)
})

test('AV: Premium beholder sin eksakte egen plassering', async () => {
  gjørMegPremium()
  state.quiz = quizRow({ show_leaderboard: false })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.userRank, 12, 'userRank er egen plassering, ikke andres stilling')
  assert.equal(svar.userEntry?.rank, 12)
})

test('AV: bla og søk gir ingen vei rundt, heller ikke for Premium', async () => {
  gjørMegPremium()
  state.quiz = quizRow({ show_leaderboard: false })

  const svar = await hent('is_team=false&search=Spiller&page=1')

  assert.equal(svar.entries.length, 0)
})

test('ÅRSAK: «disabled» og «until_closed» skilles i svaret', async () => {
  // Ett felt for invarianten (ble radene holdt tilbake?), ett for årsaken —
  // de to tilstandene betyr ulike ting for en bruker: «finnes ikke for denne
  // quizen» vs. «kommer når quizen stenger».
  state.quiz = quizRow({ show_leaderboard: false })
  assert.equal((await hent('is_team=false&limit=50')).hiddenReason, 'disabled')

  // `until_closed` måles på en kaller som FAKTISK er skjult for. Fra 29. august
  // 2026 løfter standardkalleren (gratis, med eget innsendt forsøk) skjulingen
  // selv, og ville gitt `null` her — ikke fordi årsaken sluttet å skilles, men
  // fordi hun ikke lenger er i den tilstanden årsaken beskriver.
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })
  const utenEgetForsok = state.attempts.filter(a => a.user_id !== ME)
  const medForsok = state.attempts
  state.attempts = utenEgetForsok
  assert.equal((await hent('is_team=false&limit=50')).hiddenReason, 'until_closed')
  state.attempts = medForsok

  state.quiz = quizRow()
  assert.equal((await hent('is_team=false&limit=50')).hiddenReason, null)
})

test('ÅRSAK: av-bryteren vinner når begge innstillingene slår til samtidig', async () => {
  // En deaktivert stilling er permanent; «kommer når quizen stenger» ville vært
  // et løfte som aldri innfris.
  state.quiz = quizRow({ show_leaderboard: false, hide_leaderboard_until_closed: true })

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.hiddenReason, 'disabled')
})

test('ÅRSAK: fail-safe uten quiz-rad rapporteres som «disabled»', async () => {
  state.quiz = null

  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, true)
  assert.equal(svar.hiddenReason, 'disabled', 'uten rad kan vi ikke bekrefte at stillingen er PÅ')
})

test('PÅ + ikke skjult: listen leveres som før (ingen regresjon)', async () => {
  const svar = await hent('is_team=false&limit=50')

  assert.equal(svar.leaderboardHidden, false)
  assert.equal(svar.hiddenReason, null)
  assert.equal(svar.entries.length, 10, 'gratis-trinnet i trappen: topp 10')
})

// ── SAK 4: guestRank var en sidevei rundt skjulingen ────────────────────────
// `entries` ble tømt, men `guestRank` ble regnet ut fra de SAMME radene uten å
// se på `leaderboardHidden`. En plassering er rekkefølgeinformasjon, så en
// uinnlogget kaller kunne sende ?my_correct=&my_time= og få sin eksakte plass i
// en stilling som ikke skulle ut ennå.
//
// Gjest-fixturen: 4 riktige og en svært dårlig tid. 11 spillere har flere
// riktige, og «Meg Megsen» har like mange men bedre tid → eksakt plass 13,
// som trappen (P-1, 23. august 2026) grovmaler til 10-båndets start: 11.
// Det eksakte tallet finnes ikke lenger i svaret — fram til da bandet kun
// klienten det.

const GJEST = 'is_team=false&limit=50&my_correct=4&my_time=99999'

test('LEKKASJEBEVIS: samme fixture gir bandet plass 11 når den er synlig — og null når den er skjult', async () => {
  // Positiv kontroll FØRST, på nøyaktig samme data og samme spørrestreng.
  // Uten den beviser ikke `null` noe som helst: en tom fixture, en feilstavet
  // parameter eller en NaN ville gitt samme null uten at gaten var involvert.
  // 11 (ikke eksakt 13) er også bånd-beviset: en implementasjon som mister
  // grovmalingen returnerer 13 her og felles av denne asserten.
  const synlig = await hent(GJEST, true)
  assert.equal(synlig.leaderboardHidden, false)
  assert.equal(synlig.guestRank, 11, 'positiv kontroll: 10-båndets start, aldri eksakt plass')
  assert.notEqual(synlig.guestRank, 13, 'det eksakte tallet skal ikke finnes i svaret')

  state.quiz = quizRow({ hide_leaderboard_until_closed: true })
  const skjult = await hent(GJEST, true)

  assert.equal(skjult.leaderboardHidden, true)
  assert.equal(skjult.entries.length, 0, 'radene holdes tilbake — som før')
  assert.equal(
    skjult.guestRank,
    null,
    'plasseringen utledes av de samme radene og må holdes tilbake med dem',
  )
  assert.notEqual(skjult.guestRank, 13, 'det naive svaret skal ikke kunne komme ut')
})

test('SKJULT + ÅPEN: guestRank holdes tilbake selv om gjesten spør med gyldige tall', async () => {
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })

  const svar = await hent(GJEST, true)

  assert.equal(svar.guestRank, null)
})

test('AV: show_leaderboard=false holder også guestRank tilbake (ingen stengetid opphever den)', async () => {
  // Årsakene behandles likt: begge betyr at radene ble holdt tilbake for denne
  // kalleren. Hadde gaten vært bundet til 'until_closed' alene, ville den
  // permanente av-bryteren lekket — og den har ikke engang en stengetid som
  // til slutt gjør lekkasjen irrelevant.
  state.quiz = quizRow({ show_leaderboard: false })

  const svar = await hent(GJEST, true)

  assert.equal(svar.hiddenReason, 'disabled')
  assert.equal(svar.guestRank, null)
})

test('FAIL-SAFE: uten lesbar quiz-rad holdes guestRank tilbake', async () => {
  state.quiz = null

  const svar = await hent(GJEST, true)

  assert.equal(svar.guestRank, null, 'en databaseblipp skal ikke åpne en skjult plassering')
})

test('SKJULT + STENGT: guestRank er tilbake sammen med radene', async () => {
  // Gaten følger stillingen, den avlyser ikke gjest-estimatet permanent.
  state.quiz = quizRow({ closes_at: FOR_EN_TIME_SIDEN(), hide_leaderboard_until_closed: true })

  const svar = await hent(GJEST, true)

  assert.equal(svar.leaderboardHidden, false)
  assert.equal(svar.guestRank, 11, 'bandet — trappen gjelder også etter stengetid')
})

test('guestRank-gaten rører IKKE innloggedes egen plassering', async () => {
  // Designvalget fra 1. august står: egen rad er brukerens eget resultat, ikke
  // andres rekkefølge. Denne testen finnes for at en fremtidig, for bred
  // «skjul alt»-fiks ikke skal ta med seg userEntry på veien.
  state.quiz = quizRow({ hide_leaderboard_until_closed: true })

  const innlogget = await hent('is_team=false&limit=50')
  const gjest = await hent(GJEST, true)

  assert.equal(gjest.guestRank, null, 'gjesten mister plasseringen')
  assert.ok(innlogget.userEntry, 'den innloggede beholder sin egen rad')
  assert.equal(innlogget.userEntry?.rank, 11, 'fortsatt grovmalt bånd-start for gratis')
  assert.equal(innlogget.userEntry?.correctAnswers, 4)
})

test('IKKE skjult: guestRank leveres fortsatt (bandet) for uinnloggede', async () => {
  const svar = await hent(GJEST, true)

  assert.equal(svar.guestRank, 11)
})

// ── TRAPPEN (P-1, 23. august 2026) — uinnlogget 3, gratis 10, Premium alt ────
// ?limit= er ØNSKET, ikke innvilget: verdien klemmes mot kallerens trinn.
// MUTASJONSBEVIS (kjørt 23. august 2026, målt):
//   • Fjernes tierCap fra pageSize-valget (alltid classicLimit) → 9 tester
//     ryker (denne filen + pagination-testens anon-3-assert).
//   • Byttes trinnet for anonym til FREE_TOP → 3 tester ryker.
//   • Fjernes grovmalingen av guestRank (better + 1) → 3 tester ryker (11 blir 13).

test('TRAPPEN: uinnlogget får topp 3 — også med ?limit=50', async () => {
  const svar = await hent('is_team=false&limit=50', true)

  assert.equal(svar.entries.length, 3)
  assert.deepEqual(svar.entries.map(e => e.rank), [1, 2, 3])
  assert.equal(svar.totalCount, 20, 'totaltallet består — spennet regnes ut fra det')
})

test('TRAPPEN: uinnlogget ?limit=200 gir fortsatt bare 3 rader', async () => {
  const svar = await hent('is_team=false&limit=200', true)

  assert.equal(svar.entries.length, 3, '?limit= skal ikke være en vei rundt trinnet')
})

test('TRAPPEN: gratis får topp 10 — også med ?limit=200', async () => {
  const svar = await hent('is_team=false&limit=200')

  assert.equal(svar.userIsPremium, false)
  assert.equal(svar.entries.length, 10)
  assert.deepEqual(svar.entries.map(e => e.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('TRAPPEN: Premium får hele den klassiske visningen (limit opptil 200)', async () => {
  gjørMegPremium()

  const svar = await hent('is_team=false&limit=200')

  assert.equal(svar.entries.length, 20, 'Premium har ingen trapp')
})

test('TRAPPEN: et lavere ?limit= enn trinnet respekteres (limit=1-kallene)', async () => {
  // loadSoloPlacement og «begge tall»-hentingen spør med limit=1 og leser kun
  // userEntry/totalCount — trinnet skal aldri BLÅSE OPP et lite ønske.
  const svar = await hent('is_team=false&limit=1')

  assert.equal(svar.entries.length, 1)
  assert.equal(svar.totalCount, 20)
})
