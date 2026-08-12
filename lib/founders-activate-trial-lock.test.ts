// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// ENGANGS-PRØVEPERIODE i /api/stripe/founders-activate + de tre fail-open-hullene
// i samme rute.
//
// BAKGRUNN
// Ruten målte bare NÅ-tilstand: `premium_status` og
// `personal_stripe_subscription_id`. Etter at Founders-trialene stenges
// 15. august 2026 er begge tomme for hele kohorten, og samtlige vakter åpner seg
// igjen — de 72 kunne gitt seg selv nye gratisperioder i løkke.
// `profiles.has_used_trial` er det varige merket, og det ATOMISKE CLAIMET er
// sperren; lesevakten er bare den ærlige forklaringen til brukeren.
//
// I tillegg lukkes tre hull som var åpne uavhengig av nedstengningen:
//   VAKT 4  profiloppslaget destrukturerte ikke `error` → transient DB-feil ga
//           `profile === undefined`, og alle vaktene hoppet stille over.
//   VAKT 5  catch-en rundt Stripe-oppslaget fortsatte ved ENHVER feil, så
//           Stripe-nedetid åpnet sperren.
//   VAKT 12 feilet lagring av `personal_stripe_subscription_id` ble bare logget,
//           og da hadde VAKT 5 ingenting å slå opp ved neste kall.
//
// MUTASJONSBEVIS — kjørt, ikke påstått (se rapport):
//   1. `if (profile.has_used_trial === true)` → `if (false)`
//        feller «VAKT 1 …409» + «…oppretter ingenting»
//   2. `.eq('has_used_trial', false)` fjernet fra claimet
//        feller «atomisk claim … kun ett vinner»
//   3. `has_used_trial: false` fjernet fra rollbackClaim
//        feller «rollback … tilbakestiller has_used_trial»
//   4. 503-grenen på profiloppslaget fjernet (som før)
//        feller «503 ved DB-feil …»
//   5. `if (!isMissingSubscription(err))` → `if (false)`
//        feller «503 ved Stripe-feil som ikke er resource_missing»
//   6. rollback+return fjernet fra subIdError-grenen
//        feller «VAKT 12 …»
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.STRIPE_PRICE_FOUNDERS = 'price_founders_test'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'

type ProfileRow = {
  id: string
  stripe_customer_id: string | null
  premium_status: boolean | null
  premium_source: string | null
  premium_since: string | null
  personal_stripe_subscription_id: string | null
  has_used_trial: boolean
  trial_reminder_sent_at: string | null
}

type UpdateKind = 'customerId' | 'subId' | 'claim' | 'rollback' | 'ukjent'
type UpdateResult = { data: { id: string } | null; error: { message: string } | null }
type Filter = { kind: 'eq' | 'not'; col: string; val: unknown }

type FakeSubscription = {
  id: string
  status: string
  trial_end: number | null
  deleted?: boolean
}

const state: {
  profile: ProfileRow | null
  /**
   * Sett for å la SELECT-en returnere en ANNEN (foreldet) rad enn den claimet
   * treffer. Modellerer read-committed: lesingen så verdien før den andre
   * forespørselens commit. Uten dette kan ingen test skille lesevakten fra
   * claimet, fordi lesevakten alltid svarer først.
   */
  readSnapshot: ProfileRow | null
  profileReadError: { message: string } | null
  /** site_settings-rader, key → value. */
  settings: Map<string, string>
  settingsKeysRequested: string[]
  settingsError: { message: string } | null
  updates: Array<{ kind: UpdateKind; values: Record<string, unknown>; matched: boolean }>
  /** Injiser feil på en spesifikk skriving. */
  updateErrors: Partial<Record<UpdateKind, string>>
  /** Abonnement som finnes hos Stripe. */
  stripeSubscriptions: Map<string, FakeSubscription>
  /** Sett for å simulere at Stripe er NEDE (ikke «finnes ikke»). */
  retrieveThrowsTransient: boolean
  createdSubscriptions: Array<Record<string, unknown>>
  subCreateThrows: boolean
  createdCustomers: Array<Record<string, unknown>>
  emails: Array<Record<string, unknown>>
} = {
  profile: null,
  readSnapshot: null,
  profileReadError: null,
  settings: new Map(),
  settingsKeysRequested: [],
  settingsError: null,
  updates: [],
  updateErrors: {},
  stripeSubscriptions: new Map(),
  retrieveThrowsTransient: false,
  createdSubscriptions: [],
  subCreateThrows: false,
  createdCustomers: [],
  emails: [],
}

/** Hvilken av rutens fire skrivinger dette er — utledet av feltene som settes. */
function kindOf(values: Record<string, unknown>): UpdateKind {
  if ('stripe_customer_id' in values) return 'customerId'
  if ('personal_stripe_subscription_id' in values) return 'subId'
  if (values.premium_status === true) return 'claim'
  if (values.premium_status === false) return 'rollback'
  return 'ukjent'
}

/**
 * Utfører UPDATE-en mot `state.profile`. Lesing og skriving skjer i SAMME
 * synkrone blokk, uten await imellom — det er nettopp dette som modellerer
 * radlåsen i Postgres, og som gjør samtidighetstesten meningsfull.
 */
function applyUpdate(values: Record<string, unknown>, filters: Filter[]): UpdateResult {
  const kind = kindOf(values)
  const injected = state.updateErrors[kind]
  if (injected) {
    state.updates.push({ kind, values, matched: false })
    return { data: null, error: { message: injected } }
  }

  const profile = state.profile
  if (!profile) {
    state.updates.push({ kind, values, matched: false })
    return { data: null, error: null }
  }

  const row = profile as unknown as Record<string, unknown>
  const matches = filters.every(f =>
    f.kind === 'eq'
      ? row[f.col] === f.val
      // .not(col, 'is', true) — matcher alt som IKKE er true (også null)
      : row[f.col] !== f.val,
  )

  if (!matches) {
    state.updates.push({ kind, values, matched: false })
    return { data: null, error: null }
  }

  Object.assign(row, values)
  state.updates.push({ kind, values, matched: true })
  return { data: { id: profile.id }, error: null }
}

type UpdateChain = {
  eq: (col: string, val: unknown) => UpdateChain
  not: (col: string, op: string, val: unknown) => UpdateChain
  select: (cols?: string) => { maybeSingle: () => Promise<UpdateResult> }
  then: (onOk: (r: UpdateResult) => unknown, onErr?: (e: unknown) => unknown) => Promise<unknown>
}

/**
 * Ruten bruker to former på samme UPDATE: `update().eq()` awaitet direkte, og
 * `update().eq().not().eq().select().maybeSingle()` for claimet. Kjeden må
 * derfor være BÅDE thenable og videre kjedbar.
 */
function updateChain(values: Record<string, unknown>): UpdateChain {
  const filters: Filter[] = []
  const chain: UpdateChain = {
    eq: (col, val) => { filters.push({ kind: 'eq', col, val }); return chain },
    not: (col, _op, val) => { filters.push({ kind: 'not', col, val }); return chain },
    select: () => ({ maybeSingle: async () => applyUpdate(values, filters) }),
    then: (onOk, onErr) => Promise.resolve(applyUpdate(values, filters)).then(onOk, onErr),
  }
  return chain
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: {
        getUser: async () => ({
          data: { user: { id: USER_ID, email: 'spiller@example.no' } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === 'site_settings') {
          return {
            select: () => ({
              eq: (_col: string, key: string) => {
                state.settingsKeysRequested.push(key)
                return {
                  maybeSingle: async () => ({
                    data: state.settings.has(key) ? { value: state.settings.get(key) } : null,
                    error: state.settingsError,
                  }),
                }
              },
            }),
          }
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.profileReadError ? null : (state.readSnapshot ?? state.profile),
                error: state.profileReadError,
              }),
            }),
          }),
          update: (values: Record<string, unknown>) => updateChain(values),
        }
      },
    },
  },
})

mock.module('@/lib/rate-limit-shared', {
  namedExports: { rateLimitShared: async () => ({ success: true, remaining: 99 }) },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (payload: Record<string, unknown>) => { state.emails.push(payload) },
  },
})

mock.module('@/lib/email-templates', {
  // trialWelcomeEmail er malen ruten faktisk sender fra 12. august 2026.
  // foundersWelcomeEmail beholdes i mocken fordi modulen fortsatt eksporterer
  // den — importerer ruten en gang noe mocken ikke har, feiler HELE fila med
  // «does not provide an export named …», og testene her kjører ikke i det
  // hele tatt (de forsvinner stille fra totalen, de rapporteres ikke røde).
  namedExports: {
    trialWelcomeEmail: () => '<html>velkommen</html>',
    foundersWelcomeEmail: () => '<html>velkommen</html>',
  },
})

// Speiler Stripes feilform slik ruten skiller på den: `instanceof
// StripeInvalidRequestError` OG `err.code === 'resource_missing'`.
class FakeStripeInvalidRequestError extends Error {
  code: string
  constructor(code: string, message = code) {
    super(message)
    this.code = code
  }
}

mock.module('stripe', {
  defaultExport: class FakeStripe {
    static errors = { StripeInvalidRequestError: FakeStripeInvalidRequestError }

    customers = {
      create: async (params: Record<string, unknown>) => {
        state.createdCustomers.push(params)
        return { id: `cus_new_${state.createdCustomers.length}` }
      },
    }

    subscriptions = {
      retrieve: async (id: string) => {
        if (state.retrieveThrowsTransient) throw new Error('Stripe er nede (503 fra Stripe)')
        const found = state.stripeSubscriptions.get(id)
        if (!found) throw new FakeStripeInvalidRequestError('resource_missing', `No such subscription: ${id}`)
        return found
      },
      create: async (params: Record<string, unknown>) => {
        if (state.subCreateThrows) throw new Error('Stripe avviste opprettelsen')
        state.createdSubscriptions.push(params)
        const created = {
          id: `sub_new_${state.createdSubscriptions.length}`,
          status: 'trialing',
          trial_end: Math.floor(Date.now() / 1000) + 14 * 86_400,
        }
        state.stripeSubscriptions.set(created.id, created)
        return created
      },
    }
  },
})

const { POST } = await import('@/app/api/stripe/founders-activate/route')

function activate() {
  const request = new Request('https://quizkanonen.no/api/stripe/founders-activate', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  })
  return POST(request as never)
}

/**
 * Den ekte profilen fra 12. august 2026: fikk Premium via Elkjøp, ble fjernet
 * fra organisasjonen 3. august, mistet Premium 10. august da 7-dagers grace
 * utløp. Har ALDRI hatt egen prøveperiode og står ikke i farewell-lista.
 * Denne skal slippe gjennom.
 */
const orgDepartureProfile = (): ProfileRow => ({
  id: USER_ID,
  stripe_customer_id: null,
  premium_status: false,
  premium_source: null,
  premium_since: null,
  personal_stripe_subscription_id: null,
  has_used_trial: false,
  trial_reminder_sent_at: null,
})

beforeEach(() => {
  state.profile = orgDepartureProfile()
  state.readSnapshot = null
  state.profileReadError = null
  // Prøvelengden er PÅKREVD — uten raden svarer ruten 503. Basislinjen setter
  // den derfor eksplisitt, slik at «14» i de andre testene beviselig kommer fra
  // site_settings og ikke fra en innebygd fallback.
  state.settings = new Map([['founders_new_trial_days', '14']])
  state.settingsKeysRequested = []
  state.settingsError = null
  state.updates = []
  state.updateErrors = {}
  state.stripeSubscriptions = new Map()
  state.retrieveThrowsTransient = false
  state.createdSubscriptions = []
  state.subCreateThrows = false
  state.createdCustomers = []
  state.emails = []
})

// ── VAKT 1: engangs-prøveperiode ─────────────────────────────────────────────

test('VAKT 1 — has_used_trial=true gir 409 med en forklarende, ærlig tekst', async () => {
  state.profile = { ...orgDepartureProfile(), has_used_trial: true }

  const res = await activate()
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.match(
    body.error,
    /allerede hatt en gratis prøveperiode/,
    'teksten skal si at brukeren HAR HATT en prøveperiode — ikke at noe gikk galt',
  )
})

test('VAKT 1 — en brukt prøveperiode oppretter ingenting hos Stripe', async () => {
  state.profile = { ...orgDepartureProfile(), has_used_trial: true }

  await activate()
  assert.equal(state.createdSubscriptions.length, 0, 'ingen nye gratisperioder i løkke')
  assert.equal(state.createdCustomers.length, 0)
  assert.equal(state.updates.length, 0, 'ingen skriving skal skje etter en avvist forespørsel')
})

test('has_used_trial=true selv om premium_status=false og sub-id=null — nettopp 16. august-tilstanden', async () => {
  // Dette er hele poenget: alle de gamle vaktene ser en «tom» profil her.
  state.profile = {
    ...orgDepartureProfile(),
    has_used_trial: true,
    premium_status: false,
    personal_stripe_subscription_id: null,
  }

  const res = await activate()
  assert.equal(res.status, 409, 'gammel nå-tilstand er tom — bare merket stopper dem')
})

// ── Den ekte org-avgang-profilen SKAL slippe gjennom ─────────────────────────

test('org-avgang: aldri hatt egen trial → aktivering går gjennom', async () => {
  const res = await activate()
  assert.equal(res.status, 200, 'denne brukeren har aldri hatt en prøveperiode og skal slippe gjennom')
  assert.equal((await res.json()).success, true)

  assert.equal(state.createdSubscriptions.length, 1, 'nøyaktig ett abonnement')
  assert.equal(state.profile?.has_used_trial, true, 'merket settes ved aktivering')
  assert.equal(state.profile?.premium_status, true)
  assert.equal(state.profile?.premium_source, 'founders')
  assert.equal(state.profile?.personal_stripe_subscription_id, 'sub_new_1')
  assert.equal(state.emails.length, 1, 'velkomst-e-post sendes fortsatt')
})

test('merket settes i SAMME UPDATE som claimet — ikke i en egen skriving', async () => {
  await activate()
  const claim = state.updates.find(u => u.kind === 'claim')
  assert.ok(claim, 'claimet må finnes')
  assert.equal(
    claim!.values.has_used_trial,
    true,
    'has_used_trial MÅ ligge i claim-UPDATE-en — en separat skriving ville ikke vært race-sikker',
  )
})

// ── Trial-lengde ─────────────────────────────────────────────────────────────

test('trial er 14 dager, og plass-/30-dagers-logikken er borte', async () => {
  await activate()
  assert.equal(state.createdSubscriptions[0].trial_period_days, 14)
  assert.equal(
    state.createdSubscriptions[0].trial_end,
    undefined,
    'den faste 15. august-datoen (FOUNDERS_TRIAL_END) skal ikke finnes i ruten lenger',
  )
})

test('ruten leser en NY site_settings-nøkkel — aldri founders_days_free', async () => {
  await activate()
  assert.deepEqual(state.settingsKeysRequested, ['founders_new_trial_days'])
  assert.ok(
    !state.settingsKeysRequested.includes('founders_days_free'),
    'founders_days_free = 30 styrte det gamle tilbudet og skal ikke gjenbrukes',
  )
  assert.ok(!state.settingsKeysRequested.includes('founders_max_slots'))
})

test('site_settings styrer lengden — verdien brukes som den står', async () => {
  state.settings.set('founders_new_trial_days', '21')
  await activate()
  assert.equal(state.createdSubscriptions[0].trial_period_days, 21)
})

// ── Trial-lengde: tre feilgrener, alle fail-closed ───────────────────────────
//
// Det finnes INGEN innebygd fallback. En hardkodet «14» ville truffet hver gang
// nøkkelen manglet — altså alltid, siden raden ikke finnes i prod ennå — og
// ruten ville lovet en lengde ingen har bestemt.
//
// MUTASJONSBEVIS: gjeninnfør `?? 14` (eller en DEFAULT_TRIAL_DAYS-fallback), og
// alle tre testene under ryker: de får 200 med trial_period_days = 14.

test('mangler nøkkelen i site_settings → 503, ingenting opprettes', async () => {
  state.settings = new Map() // nøyaktig dagens prod-tilstand: raden finnes ikke
  const res = await activate()
  assert.equal(res.status, 503, 'uten et innstilt tall skal ingen prøveperiode opprettes')
  assert.equal(state.createdSubscriptions.length, 0)
  assert.equal(state.createdCustomers.length, 0, 'sjekken ligger før kunde-opprettelsen')
  assert.equal(state.updates.length, 0, 'ingen claim, ingenting å rulle tilbake')
})

test('ulesbar site_settings → 503, ikke en gjettet lengde', async () => {
  state.settings.set('founders_new_trial_days', '14')
  state.settingsError = { message: 'connection terminated unexpectedly' }

  const res = await activate()
  assert.equal(res.status, 503)
  assert.equal(state.createdSubscriptions.length, 0)
  assert.equal(state.updates.length, 0)
})

test('ugyldig verdi → 503 (ikke positivt heltall)', async () => {
  for (const dårlig of ['0', '-14', '14,5', '14.5', 'fjorten', '', '14abc']) {
    state.settings = new Map([['founders_new_trial_days', dårlig]])
    state.createdSubscriptions = []
    state.updates = []
    state.profile = orgDepartureProfile()

    const res = await activate()
    assert.equal(res.status, 503, `"${dårlig}" skal avvises, ikke tolkes velvillig`)
    assert.equal(state.createdSubscriptions.length, 0, `"${dårlig}" ga et abonnement`)
  }
})

test('gyldig heltall som tekst godtas — 14 er ikke innebygd, den kommer fra raden', async () => {
  state.settings.set('founders_new_trial_days', '14')
  const res = await activate()
  assert.equal(res.status, 200)
  assert.equal(state.createdSubscriptions[0].trial_period_days, 14)
})

// ── Atomisk claim ────────────────────────────────────────────────────────────

test('atomisk claim: to samtidige kall — kun ett vinner, kun ett abonnement', async () => {
  const [a, b] = await Promise.all([activate(), activate()])

  const statuses = [a.status, b.status].sort()
  assert.deepEqual(statuses, [200, 400], 'nøyaktig én skal vinne')
  assert.equal(
    state.createdSubscriptions.length,
    1,
    'to gratisperioder på samme konto er hele feilen sperren finnes for',
  )

  const matchedClaims = state.updates.filter(u => u.kind === 'claim' && u.matched)
  assert.equal(matchedClaims.length, 1, 'kun ett claim kan matche raden')
})

test('claimet stopper en TOCTOU der lesingen ikke SÅ merket — sperren er i raden', async () => {
  // Dette er den ENESTE testformen som skiller claimet fra lesevakten: raden er
  // allerede merket, men SELECT-en returnerte en foreldet versjon (read-committed
  // — lesingen skjedde før den andre forespørselens commit), så lesevakten har
  // ingen mulighet til å se det.
  //
  // premium_status=false er ikke konstruert: det er nøyaktig steady-state for
  // hele kohorten etter 15. august — trialen er ute, Premium er av, merket står.
  // Da slipper `.not('premium_status', 'is', true)` glatt gjennom, og
  // `.eq('has_used_trial', false)` er det eneste som står imellom.
  //
  // MUTASJONSBEVIS: fjernes .eq('has_used_trial', false) fra claimet, får denne
  // brukeren sin ANDRE gratisperiode og begge assertene ryker. (Uten denne
  // testen overlevde nettopp den mutasjonen — resten av suiten fanget den ikke.)
  state.profile = { ...orgDepartureProfile(), has_used_trial: true, premium_status: false }
  state.readSnapshot = { ...orgDepartureProfile(), has_used_trial: false }

  const res = await activate()
  assert.equal(res.status, 400, 'claimet skal ikke matche en rad som alt er merket')
  assert.equal(
    state.createdSubscriptions.length,
    0,
    'uten claim-filteret ville dette vært en ny gratisperiode på en konto som alt har hatt én',
  )
})

// ── VAKT 4: profiloppslaget er fail-closed ───────────────────────────────────

test('503 ved DB-feil på profiloppslaget — og INGENTING opprettes', async () => {
  state.profileReadError = { message: 'connection terminated unexpectedly' }

  const res = await activate()
  assert.equal(res.status, 503, 'kan vi ikke lese profilen, VET vi ikke om trialen er brukt')
  assert.equal(state.createdSubscriptions.length, 0, 'fail-open her ville delt ut gratisperioder')
  assert.equal(state.createdCustomers.length, 0)
  assert.equal(state.updates.length, 0)
})

test('503 når profilraden ikke finnes — ikke stille videre', async () => {
  state.profile = null

  const res = await activate()
  assert.equal(res.status, 503)
  assert.equal(state.createdSubscriptions.length, 0)
})

// ── VAKT 5: Stripe-oppslaget ─────────────────────────────────────────────────

test('503 ved Stripe-feil som IKKE er resource_missing — nedetid åpner ikke sperren', async () => {
  state.profile = { ...orgDepartureProfile(), personal_stripe_subscription_id: 'sub_gammel' }
  state.retrieveThrowsTransient = true

  const res = await activate()
  assert.equal(res.status, 503)
  assert.equal(state.createdSubscriptions.length, 0, 'usikkerhet skal ikke gi en ny gratisperiode')
  assert.equal(state.updates.length, 0)
})

test('resource_missing: abonnementet er beviselig borte → aktivering fortsetter', async () => {
  state.profile = { ...orgDepartureProfile(), personal_stripe_subscription_id: 'sub_slettet' }
  // Bevisst IKKE lagt i state.stripeSubscriptions → retrieve kaster resource_missing.

  const res = await activate()
  assert.equal(res.status, 200)
  assert.equal(state.createdSubscriptions.length, 1)
})

test('deleted:true behandles som borte, ikke som levende dekning', async () => {
  state.profile = { ...orgDepartureProfile(), personal_stripe_subscription_id: 'sub_del' }
  state.stripeSubscriptions.set('sub_del', { id: 'sub_del', status: 'trialing', trial_end: null, deleted: true })

  const res = await activate()
  assert.equal(res.status, 200)
})

test('levende abonnement gir 409 — sekundær sperre er beholdt', async () => {
  state.profile = { ...orgDepartureProfile(), personal_stripe_subscription_id: 'sub_live' }
  state.stripeSubscriptions.set('sub_live', { id: 'sub_live', status: 'trialing', trial_end: null })

  const res = await activate()
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /aktiv Founders-prøveperiode/)
  assert.equal(state.createdSubscriptions.length, 0)
})

test('kansellert abonnement er ikke levende dekning', async () => {
  state.profile = { ...orgDepartureProfile(), personal_stripe_subscription_id: 'sub_kansellert' }
  state.stripeSubscriptions.set('sub_kansellert', { id: 'sub_kansellert', status: 'canceled', trial_end: null })

  const res = await activate()
  assert.equal(res.status, 200, 'her er det has_used_trial som skal stoppe dem — ikke denne vakten')
})

// ── Rollback ─────────────────────────────────────────────────────────────────

test('rollback ved feilet subscriptions.create tilbakestiller has_used_trial', async () => {
  state.subCreateThrows = true

  const res = await activate()
  assert.equal(res.status, 500)
  assert.equal(
    state.profile?.has_used_trial,
    false,
    'merket betyr «har HATT en prøveperiode», ikke «har trykket på knappen»',
  )
  assert.equal(state.profile?.premium_status, false)
  assert.equal(state.profile?.premium_source, null)
})

test('etter rollback kan brukeren prøve igjen og lykkes', async () => {
  state.subCreateThrows = true
  await activate()

  state.subCreateThrows = false
  const res = await activate()
  assert.equal(res.status, 200, 'et mislykket forsøk skal ikke låse brukeren ute for godt')
  assert.equal(state.createdSubscriptions.length, 1)
})

// ── VAKT 12: lagring av subscription-id ──────────────────────────────────────

test('VAKT 12 — feilet lagring av personal_stripe_subscription_id gir 500 og rollback', async () => {
  state.updateErrors.subId = 'kunne ikke skrive'

  const res = await activate()
  assert.equal(res.status, 500, 'en aktivering vi ikke kan spore er en FEILET aktivering')
  assert.equal(
    state.profile?.has_used_trial,
    false,
    'ellers ville brukeren mistet prøveperioden sin til en skrivefeil',
  )
  assert.equal(state.profile?.premium_status, false)
  assert.ok(
    state.updates.some(u => u.kind === 'rollback'),
    'rollback-grenen skal faktisk kjøres, ikke bare logges',
  )
})

test('VAKT 12 — feilet lagring sender ikke velkomst-e-post', async () => {
  state.updateErrors.subId = 'kunne ikke skrive'
  await activate()
  assert.equal(state.emails.length, 0, 'ikke bekreft en aktivering som ble rullet tilbake')
})

// ── Kunde-opprettelse ────────────────────────────────────────────────────────

test('manglende stripe_customer_id: kunden opprettes med userId i metadata', async () => {
  await activate()
  assert.equal(state.createdCustomers.length, 1)
  assert.equal(
    (state.createdCustomers[0] as { metadata?: { userId?: string } }).metadata?.userId,
    USER_ID,
  )
  assert.equal(state.profile?.stripe_customer_id, 'cus_new_1')
})

test('feilet lagring av stripe_customer_id stopper ikke aktiveringen, men logges', async () => {
  // Bevisst ikke-blokkerende: id-en brukes videre i denne forespørselen, og
  // idempotencyKey gir SAMME kunde tilbake ved et nytt forsøk.
  state.updateErrors.customerId = 'timeout'

  const res = await activate()
  assert.equal(res.status, 200)
  assert.equal(state.createdSubscriptions[0].customer, 'cus_new_1')
})
