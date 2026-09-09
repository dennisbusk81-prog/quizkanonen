// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// RAD E i beslutningstabellen: brukeren har en aktiv verdikode og starter et
// B2C-abonnement.
//
// Pause duger ikke i denne retningen — første faktura trekkes ved selve
// checkout, altså før vi i det hele tatt får se abonnementet. Riktig mekanisme
// er subscription_data.trial_end på checkout-sesjonen, som utsetter første
// faktura til koden løper ut.
//
// MUTASJONSBEVIS: fjernes trial_end-blokken i ruten, forsvinner
// subscription_data fra sesjonen og første assert ryker — kunden ville da blitt
// belastet umiddelbart for en periode de allerede har gratis.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { CodeCoverage, StripeCoverage } from './premium-state'

process.env.NEXT_PUBLIC_SITE_URL = 'https://quizkanonen.no'
process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_live_monthly'
process.env.STRIPE_PRICE_PREMIUM_YEARLY = 'price_live_yearly'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const USER_ID = '5c312683-2010-46d5-8a9d-a3529ee2e285'

type StripeCustomerRow = { id: string; deleted?: boolean }

const state: {
  code: CodeCoverage | null
  /** Brukerens levende abonnement slik dobbeltkjøp-vakten ser det. */
  stripeCoverage: StripeCoverage | null
  sessions: Array<Record<string, unknown>>
  /** profiles.stripe_customer_id slik den ligger i databasen. */
  storedCustomerId: string | null
  /** Kunder som finnes hos Stripe. Mangler id-en her → resource_missing. */
  stripeCustomers: Map<string, StripeCustomerRow>
  /** Sett for å simulere at Stripe er nede (ikke en «ugyldig kunde»-feil). */
  retrieveThrowsTransient: boolean
  createdCustomers: Array<Record<string, unknown>>
  profileUpdates: Array<Record<string, unknown>>
  /** Profil-oppslaget svarer med error — «kunne ikke lese», ikke «fant ingenting». */
  profileReadFails: boolean
  /** Profil-oppslaget lykkes, men finner ingen rad (maybeSingle → null). */
  profileRowMissing: boolean
  /** Kunde-id-ene dobbeltabonnement-vakten har spurt Stripe om. */
  coverageLookups: Array<string | null>
  /** Antall customers.retrieve-kall — Stripe-trafikk som ikke skal skje ved lesefeil. */
  retrieveCalls: number
} = {
  code: null,
  stripeCoverage: null,
  sessions: [],
  storedCustomerId: null,
  stripeCustomers: new Map(),
  retrieveThrowsTransient: false,
  createdCustomers: [],
  profileUpdates: [],
  profileReadFails: false,
  profileRowMissing: false,
  coverageLookups: [],
  retrieveCalls: 0,
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (state.profileReadFails) {
                return { data: null, error: { code: '57P01', message: 'simulert lesefeil på profiles' } }
              }
              if (state.profileRowMissing) return { data: null, error: null }
              return { data: { stripe_customer_id: state.storedCustomerId }, error: null }
            },
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: async () => {
            state.profileUpdates.push(values)
            return { error: null }
          },
        }),
      }),
    },
  },
})

// Checkout er migrert til den DELTE rate-limiteren (Upstash). Mocken må derfor
// treffe den nye modulen — mockes bare den gamle, kjører den ekte
// rateLimitShared med sin modul-lokale Map, og testene ville påvirket
// hverandre gjennom en teller som lever mellom dem.
mock.module('@/lib/rate-limit-shared', {
  namedExports: { rateLimitShared: async () => ({ success: true, remaining: 99 }) },
})

mock.module('@/lib/premium-state-io', {
  namedExports: {
    getCodeCoverage: async () => state.code,
    getStripeCoverage: async (customerId: string | null) => {
      state.coverageLookups.push(customerId)
      return state.stripeCoverage
    },
  },
})

// Speiler Stripes feilform så nøyaktig som ruten trenger: den skiller på
// `instanceof StripeInvalidRequestError` OG `err.code === 'resource_missing'`.
class FakeStripeInvalidRequestError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

mock.module('stripe', {
  defaultExport: class FakeStripe {
    static errors = { StripeInvalidRequestError: FakeStripeInvalidRequestError }

    customers = {
      retrieve: async (id: string) => {
        state.retrieveCalls++
        if (state.retrieveThrowsTransient) throw new Error('Stripe er nede')
        const found = state.stripeCustomers.get(id)
        if (!found) throw new FakeStripeInvalidRequestError('resource_missing')
        return found
      },
      create: async (params: Record<string, unknown>) => {
        state.createdCustomers.push(params)
        const created = { id: `cus_new_${state.createdCustomers.length}` }
        state.stripeCustomers.set(created.id, created)
        return created
      },
    }

    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.sessions.push(params)
          return { url: 'https://checkout.stripe.com/test' }
        },
      },
    }
  },
})

const { POST } = await import('@/app/api/stripe/checkout/route')

function checkout(priceId = 'STRIPE_PRICE_PREMIUM_MONTHLY') {
  const request = new Request('https://quizkanonen.no/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({
      priceId,
      userId: USER_ID,
      email: 'kunde@example.no',
    }),
  })
  return POST(request as never)
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const activeCode = (expiresAt: string | null): CodeCoverage =>
  ({ redemptionId: 'r1', codeId: 'c1', expiresAt })

beforeEach(() => {
  state.code = null
  state.stripeCoverage = null
  state.sessions = []
  state.storedCustomerId = null
  state.stripeCustomers = new Map()
  state.retrieveThrowsTransient = false
  state.createdCustomers = []
  state.profileUpdates = []
  state.profileReadFails = false
  state.profileRowMissing = false
  state.coverageLookups = []
  state.retrieveCalls = 0
})

test('RAD E — aktiv kode utsetter første faktura til koden løper ut', async () => {
  const endsAt = inDays(30)
  state.code = activeCode(endsAt)

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.sessions.length, 1)

  const subData = state.sessions[0].subscription_data as { trial_end?: number } | undefined
  assert.ok(subData, 'subscription_data må settes når en kode er aktiv')
  assert.equal(
    subData!.trial_end,
    Math.floor(new Date(endsAt).getTime() / 1000),
    'trial_end skal treffe kodens sluttdato nøyaktig',
  )
})

test('uten aktiv kode opprettes sesjonen som før — ingen trial', async () => {
  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.sessions[0].subscription_data, undefined, 'ingen regresjon for vanlig kjøp')
})

test('utløpt kode teller ikke — getCodeCoverage returnerer null', async () => {
  state.code = null // speiler at I/O-laget filtrerer bort utløpte perioder
  await checkout()
  assert.equal(state.sessions[0].subscription_data, undefined)
})

test('kode med under 48 timer igjen: Stripes minstekrav gjør trial umulig', async () => {
  // Stripe krever at trial_end ligger minst 48 timer fram. Da starter
  // abonnementet normalt — differansen er under to døgn, og alternativet ville
  // vært å avvise et kjøp kunden faktisk vil gjennomføre.
  state.code = activeCode(inDays(1))

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.sessions[0].subscription_data, undefined)
})

test('kode med nøyaktig over 48 timer igjen får trial', async () => {
  state.code = activeCode(new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString())
  await checkout()
  assert.ok((state.sessions[0].subscription_data as { trial_end?: number })?.trial_end)
})

test('permanent kode: kjøp avvises i stedet for å ta betalt for noe de har', async () => {
  state.code = activeCode(null)

  const res = await checkout()
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /ubestemt tid/)
  assert.equal(state.sessions.length, 0, 'ingen checkout-sesjon skal opprettes')
})

// ── Gjenbruk av Stripe-kunde (8. august 2026) ────────────────────────────────
//
// Ruten sendte kun `customer_email`, så Stripe opprettet en NY kunde for hvert
// kjøp — også for de 76 Founders-brukerne som allerede hadde en fra
// founders-activate. Webhooken skrev den nye id-en over profilen, og det gamle
// Founders-abonnementet ble liggende igjen på en kunde ingen rad pekte på. Når
// det abonnementet nådde trial_end 15. august, fant `invoice.payment_failed`
// ingen profil på kunde-id-en, stale-vaktene der krever en profil for å
// undertrykke noe, og kunden som NETTOPP hadde betalt fikk «Prøveperioden din
// er over».
//
// MUTASJONSBEVIS: gjeninnfør `customer_email: email ?? undefined` i stedet for
// customer-gjenbruket, og testen «MUTASJONSBEVIS» under ryker på begge
// assertene — `customer` blir undefined og `customer_email` dukker opp igjen
// på en bruker som har en kunde fra før. Fjernes bare `resolveCustomerId`-kallet,
// ryker i tillegg «ingen NY kunde opprettes».

test('MUTASJONSBEVIS — eksisterende kunde gjenbrukes, aldri customer_email', async () => {
  state.storedCustomerId = 'cus_founder'
  state.stripeCustomers.set('cus_founder', { id: 'cus_founder' })

  const res = await checkout()
  assert.equal(res.status, 200)

  const session = state.sessions[0]
  assert.equal(
    session.customer,
    'cus_founder',
    'sesjonen MÅ bindes til den eksisterende kunden — ellers får Founders-brukeren en duplikat-kunde',
  )
  assert.equal(
    session.customer_email,
    undefined,
    'customer_email er det som får Stripe til å lage en ny kunde — den skal ikke være med',
  )
})

test('eksisterende kunde: INGEN ny kunde opprettes hos Stripe', async () => {
  state.storedCustomerId = 'cus_founder'
  state.stripeCustomers.set('cus_founder', { id: 'cus_founder' })

  await checkout()
  assert.equal(state.createdCustomers.length, 0, 'kunden finnes — ingenting skal opprettes')
  assert.equal(state.profileUpdates.length, 0, 'profilen peker allerede riktig — ingen skriving')
})

test('uten lagret kunde: Stripe oppretter via customer_email, som før', async () => {
  state.storedCustomerId = null

  const res = await checkout()
  assert.equal(res.status, 200)

  const session = state.sessions[0]
  assert.equal(session.customer, undefined)
  assert.equal(
    session.customer_email,
    'kunde@example.no',
    'en bruker uten kunde har ingenting å duplisere — uendret oppførsel, webhooken skriver id-en',
  )
  assert.equal(state.createdCustomers.length, 0, 'ingen eksplisitt customers.create på denne stien')
})

test('ugyldig lagret kunde: ny opprettes, profilen oppdateres, checkout krasjer ikke', async () => {
  // Kunden er slettet i Stripe-dashbordet. Uten fail-safen ville sessions.create
  // kastet, og brukeren fått 500 på et kjøp de faktisk ville gjennomføre.
  state.storedCustomerId = 'cus_slettet'
  // Bevisst IKKE lagt i state.stripeCustomers → retrieve kaster resource_missing.

  const res = await checkout()
  assert.equal(res.status, 200, 'checkout skal fullføre, ikke krasje')

  assert.equal(state.createdCustomers.length, 1, 'nøyaktig én ny kunde')
  assert.equal(
    (state.createdCustomers[0] as { metadata?: { userId?: string } }).metadata?.userId,
    USER_ID,
    'den nye kunden må bære userId — det er sporet tilbake til profilen',
  )

  assert.equal(state.profileUpdates.length, 1, 'profilen skal peke på den nye kunden med én gang')
  assert.equal(state.profileUpdates[0].stripe_customer_id, 'cus_new_1')

  assert.equal(state.sessions[0].customer, 'cus_new_1')
  assert.equal(state.sessions[0].customer_email, undefined)
})

test('kunde markert deleted:true behandles som ugyldig, ikke som gyldig', async () => {
  // Stripe kaster ikke for en slettet kunde man kjenner id-en til — den svarer
  // med et objekt der `deleted: true`. Leses ikke det flagget, sendes en død
  // kunde-id inn i sessions.create og kjøpet feiler.
  state.storedCustomerId = 'cus_slettet'
  state.stripeCustomers.set('cus_slettet', { id: 'cus_slettet', deleted: true })

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.createdCustomers.length, 1)
  assert.equal(state.sessions[0].customer, 'cus_new_1')
})

test('Stripe nede: lagret kunde brukes likevel — ingen duplikat på usikkert grunnlag', async () => {
  // Kritisk skille. En transient feil betyr IKKE at kunden er ugyldig, og å
  // opprette en ny på det grunnlaget ville gjenskapt nøyaktig den buggen
  // gjenbruket finnes for å fjerne — bare sjeldnere og vanskeligere å se.
  state.storedCustomerId = 'cus_founder'
  state.retrieveThrowsTransient = true

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.createdCustomers.length, 0, 'ingen ny kunde ved usikkerhet')
  assert.equal(state.sessions[0].customer, 'cus_founder')
})

test('gjenbruk og kode-trial virker sammen — Rad E er ikke rørt', async () => {
  const endsAt = inDays(30)
  state.code = activeCode(endsAt)
  state.storedCustomerId = 'cus_founder'
  state.stripeCustomers.set('cus_founder', { id: 'cus_founder' })

  await checkout()
  assert.equal(state.sessions[0].customer, 'cus_founder')
  assert.equal(
    (state.sessions[0].subscription_data as { trial_end?: number }).trial_end,
    Math.floor(new Date(endsAt).getTime() / 1000),
  )
})

// ── Vakt mot dobbelt abonnement (30. august 2026) ────────────────────────────
//
// Checkout sjekket aldri om brukeren allerede hadde et levende abonnement, og
// getStripeCoverage henter limit:1 — kjøp nummer to ga to samtidige
// abonnementer der det andre var usynlig for all app-logikk. Stille
// dobbelttrekk på ekte penger.
//
// «Levende» er isStripeLive (active + trialing) — samme definisjon som resten
// av kodebasen, og samme vakt som founders-activate allerede har. past_due
// sperres BEVISST ikke: karens er ikke levende dekning, og et nytt kjøp er da
// et lovlig valg.
//
// MUTASJONSBEVIS: nøytraliseres vakten (`if (isStripeLive(...))` → `if
// (false)`), ryker begge 409-testene under — sesjonen opprettes da for en
// bruker som allerede betaler. Gjøres den ubetinget (`if (true)`), ryker
// past_due-testen OG hele Rad E-/gjenbruks-suiten over, siden ingen lenger
// får kjøpe i det hele tatt.

const levendeSub = (status: string): StripeCoverage => ({
  subscriptionId: 'sub_eksisterende',
  status,
  trialEnd: null,
  currentPeriodEnd: inDays(20),
  pauseResumesAt: null,
})

test('aktivt abonnement → 409, ingen sesjon opprettes, meldingen sier hva man gjør i stedet', async () => {
  state.stripeCoverage = levendeSub('active')

  const res = await checkout()
  assert.equal(res.status, 409)
  assert.equal(state.sessions.length, 0, 'ingen checkout-sesjon skal opprettes — det er selve dobbelttrekket')
  assert.match((await res.json()).error, /Administrer abonnement/, 'meldingen skal peke på veien videre, ikke bare avvise')
})

test('trialing (Founders uten kort) → 409 — konverteringsveien er portalen', async () => {
  state.stripeCoverage = levendeSub('trialing')

  const res = await checkout()
  assert.equal(res.status, 409)
  assert.equal(state.sessions.length, 0)
})

test('past_due sperres IKKE — isStripeLive-definisjonen er delt, ikke en ny', async () => {
  // Et abonnement i dunning er ikke levende dekning (lib/premium-state.ts).
  // Brukeren kan la det dø og kjøpe på nytt — det skal ikke sperres.
  state.stripeCoverage = levendeSub('past_due')

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(state.sessions.length, 1, 'kjøpet skal gå gjennom')
})

test('paused abonnement (rad B/D-stabling) er fortsatt active → 409', async () => {
  // Kode stablet på betalt abonnement pauser innkrevingen, men statusen hos
  // Stripe er fortsatt 'active'. Et kjøp til ville gitt sub nummer to.
  state.stripeCoverage = { ...levendeSub('active'), pauseResumesAt: inDays(10) }

  const res = await checkout()
  assert.equal(res.status, 409)
  assert.equal(state.sessions.length, 0)
})

// ── Årspris i hvitelisten (30. august 2026) ─────────────────────────────────
//
// ALLOWED_PRICE_IDS ble til PRICE_ENV_BY_SYMBOL: symbolsk navn → env-variabel.
// Klienten sender fortsatt KUN symbolske navn; de ekte price-ID-ene finnes
// bare i Vercels env og kan ikke velges utenfra.
//
// MUTASJONSBEVIS: fjern STRIPE_PRICE_PREMIUM_YEARLY-nøkkelen fra mappen i
// ruten, og «årsprisen godtas» + «rad E med årspris» ryker begge med 400.

test('årsprisen godtas — sesjonen bruker env-verdien for årsprisen', async () => {
  const res = await checkout('STRIPE_PRICE_PREMIUM_YEARLY')
  assert.equal(res.status, 200)
  assert.equal(state.sessions.length, 1)
  const lineItems = state.sessions[0].line_items as Array<{ price?: string }>
  assert.equal(
    lineItems[0].price,
    'price_live_yearly',
    'sesjonen skal bære ÅRSPRISENS env-verdi, ikke månedsprisens',
  )
})

test('ukjent symbolsk navn avvises med 400 — også arvede objektnøkler', async () => {
  for (const ugyldig of ['STRIPE_PRICE_UKJENT', 'constructor', 'toString']) {
    const res = await checkout(ugyldig)
    assert.equal(res.status, 400, `«${ugyldig}» skulle vært avvist`)
  }
  assert.equal(state.sessions.length, 0, 'ingen sesjon for noen av dem')
})

test('ekte price-ID avvises — klienten kan aldri velge pris direkte', async () => {
  // Selv den FAKTISKE verdien env-variabelen bærer er ugyldig som body-verdi:
  // vakten er at klienten kun får sende symbolske navn.
  const res = await checkout('price_live_yearly')
  assert.equal(res.status, 400)
  assert.equal(state.sessions.length, 0)
})

test('rad E med årspris: aktiv kode gir trial_end også der', async () => {
  const endsAt = inDays(30)
  state.code = activeCode(endsAt)

  const res = await checkout('STRIPE_PRICE_PREMIUM_YEARLY')
  assert.equal(res.status, 200)
  assert.equal(
    (state.sessions[0].subscription_data as { trial_end?: number }).trial_end,
    Math.floor(new Date(endsAt).getTime() / 1000),
    'kode-perioden skal utsette første faktura uavhengig av valgt plan',
  )
  assert.equal((state.sessions[0].line_items as Array<{ price?: string }>)[0].price, 'price_live_yearly')
})

test('hvitelistet navn uten env-verdi → 500 med klar tekst, ingen sesjon', async () => {
  // Konfigurasjonsfeilen som ellers hadde vært stille: navnet står i mappen,
  // men Vercel mangler variabelen. undefined skal ALDRI nå sessions.create.
  const original = process.env.STRIPE_PRICE_PREMIUM_YEARLY
  delete process.env.STRIPE_PRICE_PREMIUM_YEARLY
  try {
    const res = await checkout('STRIPE_PRICE_PREMIUM_YEARLY')
    assert.equal(res.status, 500)
    assert.match((await res.json()).error, /ikke tilgjengelig/)
    assert.equal(state.sessions.length, 0, 'sessions.create skal aldri kalles med undefined pris')
  } finally {
    process.env.STRIPE_PRICE_PREMIUM_YEARLY = original
  }
})

test('Rad E består: kode aktiv + INGEN levende sub → kjøp med trial_end', async () => {
  // Selve beviset på at vakten ikke brakk rad E: kode-brukeren uten abonnement
  // går forbi vakten og får trial_end som før.
  const endsAt = inDays(30)
  state.code = activeCode(endsAt)
  state.stripeCoverage = null

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.equal(
    (state.sessions[0].subscription_data as { trial_end?: number }).trial_end,
    Math.floor(new Date(endsAt).getTime() / 1000),
  )
})

// ── Intervallet legges i sesjonens metadata (3. september 2026) ─────────────
// Webhooken (checkout.session.completed) leser `metadata.interval` for å si
// «hvert år» til en årsabonnent i kjøpsbekreftelsen. Sesjonsobjektet i
// hendelsen bærer ellers verken pris eller linjer. Se lib/billing-interval.ts.

test('metadata.interval = year for årsprisen', async () => {
  const res = await checkout('STRIPE_PRICE_PREMIUM_YEARLY')
  assert.equal(res.status, 200)
  assert.deepEqual(state.sessions[0].metadata, { userId: USER_ID, interval: 'year' })
})

test('metadata.interval = month for månedsprisen', async () => {
  const res = await checkout('STRIPE_PRICE_PREMIUM_MONTHLY')
  assert.equal(res.status, 200)
  assert.deepEqual(state.sessions[0].metadata, { userId: USER_ID, interval: 'month' })
})

// ── Lesefeil på profilen stopper før Stripe (punkt 3, 9. september 2026) ────
//
// Profilen ble lest to ganger uten error-sjekk — foran dobbeltabonnement-
// vakten og inne i resolveCustomerId — og en lesefeil så ut som «ingen lagret
// kunde». Da spurte vakten Stripe om kunde null (→ ingen sub → slapp gjennom),
// og sesjonen gikk med customer_email, som får Stripe til å opprette en
// duplikatkunde. Nå leses den ÉN gang, og feiler lesingen, stopper ruten før
// et eneste Stripe-kall. Null rader / null id er fortsatt et gyldig svar.
//
// MUTASJONSBEVIS: fjernes `if (profileError)`-blokken i ruten, ryker
// «profil-oppslaget feiler → 503 og INGEN Stripe-kall» — vakten spør om null,
// og sesjonen opprettes via customer_email. Sendes null i stedet for
// storedCustomerId til getStripeCoverage eller resolveCustomerId, ryker
// «oppslaget lykkes → …» på henholdsvis coverageLookups og session.customer.

test('profil-oppslaget feiler → 503 og INGEN Stripe-kall', async () => {
  // Kunden finnes både i DB og hos Stripe — det er LESINGEN som feiler.
  state.storedCustomerId = 'cus_founder'
  state.stripeCustomers.set('cus_founder', { id: 'cus_founder' })
  state.profileReadFails = true

  const logged: unknown[][] = []
  const restore = mock.method(console, 'error', (...args: unknown[]) => { logged.push(args) })
  let res: Response
  try {
    res = await checkout()
  } finally {
    restore.mock.restore()
  }

  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /Prøv igjen/)

  assert.deepEqual(state.coverageLookups, [], 'dobbeltabonnement-vakten skal ikke spørre Stripe på et gjettet null')
  assert.equal(state.retrieveCalls, 0, 'ingen customers.retrieve')
  assert.equal(state.createdCustomers.length, 0, 'ingen duplikatkunde')
  assert.equal(state.sessions.length, 0, 'ingen checkout-sesjon')
  assert.equal(state.profileUpdates.length, 0, 'ingen skriving til profilen')
  assert.ok(
    logged.some(a => String(a[0]).startsWith('[checkout] kunne ikke lese profil') && String(a[0]).includes(USER_ID)),
    `forventet [checkout]-logglinje med bruker-id, fikk: ${JSON.stringify(logged)}`,
  )
})

test('profil uten rad → som i dag: vakten spør om null, sesjonen går via customer_email', async () => {
  state.profileRowMissing = true

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.deepEqual(state.coverageLookups, [null])
  assert.equal(state.sessions[0].customer, undefined)
  assert.equal(state.sessions[0].customer_email, 'kunde@example.no')
  assert.equal(state.createdCustomers.length, 0)
})

test('oppslaget lykkes → samme lagrede kunde-id går til både vakten og sesjonen', async () => {
  state.storedCustomerId = 'cus_founder'
  state.stripeCustomers.set('cus_founder', { id: 'cus_founder' })

  const res = await checkout()
  assert.equal(res.status, 200)
  assert.deepEqual(state.coverageLookups, ['cus_founder'], 'vakten skal sjekke den lagrede kunden, ikke null')
  assert.equal(state.sessions[0].customer, 'cus_founder')
  assert.equal(state.createdCustomers.length, 0)
})
