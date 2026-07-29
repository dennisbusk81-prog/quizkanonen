// Kjøres med:  npm test
//
// INTEGRASJONSTEST av B2B-lås-grenene i den ekte Stripe-webhooken
// (29. juli 2026). `mock.module` bytter ut stripe-SDK-et, supabase-admin,
// e-postsending og premium-rekalkuleringen, slik at produksjonskoden kjøres
// uendret. Søsterfilen stripe-webhook-route.test.ts dekker B2C-grenene (der
// ingen org matcher kunden); denne dekker org-grenene.
//
// To hull som fikses her:
//   DEL 1 — orgCancelledEmail ble KUN sendt fra subscription.deleted. En org
//           som ble låst på past_due/unpaid mistet tilgangen for alle ansatte
//           uten at admin fikk beskjed i det hele tatt.
//   DEL 2 — org-admin-e-post ble hentet med .limit(1). Admin nr. 2+ fikk
//           aldri noe varsel.
//
// MUTASJONSBEVIS (verifisert manuelt):
//   * Fjernes shouldNotifyAdminsOfDunningLock-blokken i updated-grenen,
//     feiler «past_due låser org → admin varsles» med 0 admin-e-poster.
//   * Returnerer getOrgAdminEmails kun første admin (gammel .limit(1)),
//     feiler både «past_due …» og «deleted → alle admins …» med 1 mottaker.
//   * Fjernes overgangsvakten, feiler «unpaid etter past_due → stille».
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy'

const CUSTOMER = 'cus_elkjop'
const SUB = 'sub_elkjop'

type Member = { user_id: string; role: string }

const state: {
  event: Record<string, unknown>
  org: { id: string; name: string; slug: string; stripe_subscription_id: string; subscription_status: string } | null
  members: Member[]
  emailsById: Record<string, string>
  orgUpdates: Array<Record<string, unknown>>
  sent: Array<{ to: string; subject: string }>
  errors: string[]
  /** Abonnement stripe.subscriptions.list skal returnere for kunden. */
  stripeSubs: Array<{ id: string; status: string }>
  listThrows: boolean
  listCalls: number
} = {
  event: {},
  org: null,
  members: [],
  emailsById: {},
  orgUpdates: [],
  sent: [],
  errors: [],
  stripeSubs: [],
  listThrows: false,
  listCalls: 0,
}

class MockStripe {
  webhooks = { constructEvent: () => state.event }
  subscriptions = {
    list: async () => {
      state.listCalls++
      // `subscriptions` er et instansfelt, ikke på prototypen — et test som
      // vil simulere et Stripe-utfall MÅ derfor gå via dette flagget. Å bytte
      // ut MockStripe.prototype.subscriptions gjør ingenting.
      if (state.listThrows) throw new Error('Stripe nede')
      return { data: state.stripeSubs }
    },
    retrieve: async (id: string) => ({ id, status: 'past_due' }),
  }
  customers = {
    retrieve: async () => ({ deleted: false, email: 'noen@elkjop.test' }),
    listPaymentMethods: async () => ({ data: [{ id: 'pm_1' }] }),
  }
}
mock.module('stripe', { defaultExport: MockStripe })

function builder(table: string) {
  // Filtrene registreres PER spørring, ikke globalt — flere ulike
  // organization_members-spørringer kjører i samme hendelse.
  const filters: Record<string, unknown> = {}
  const b = {
    select() { return b },
    eq(col: string, val: unknown) { filters[`eq:${col}`] = val; return b },
    neq(col: string, val: unknown) { filters[`neq:${col}`] = val; return b },
    in() { return b },
    limit() { return b },
    insert() { return Promise.resolve({ error: null }) },
    delete() { return Promise.resolve({ error: null }) },
    update(values: Record<string, unknown>) {
      if (table === 'organizations') state.orgUpdates.push(values)
      return b
    },
    maybeSingle() {
      if (table === 'organizations') return Promise.resolve({ data: state.org, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    then(resolve: (v: unknown) => void) {
      if (table === 'organization_members') {
        let rows = state.members
        if (filters['eq:role']) rows = rows.filter(m => m.role === filters['eq:role'])
        if (filters['neq:role']) rows = rows.filter(m => m.role !== filters['neq:role'])
        return resolve({ data: rows.map(m => ({ user_id: m.user_id })), error: null })
      }
      return resolve({ data: null, error: null })
    },
  }
  return b
}

mock.module('@/lib/supabase-admin', {
  namedExports: {
    supabaseAdmin: {
      from: (table: string) => builder(table),
      auth: {
        admin: {
          getUserById: async (id: string) => ({ data: { user: state.emailsById[id] ? { id, email: state.emailsById[id] } : null } }),
          listUsers: async () => ({
            data: { users: Object.entries(state.emailsById).map(([id, email]) => ({ id, email })) },
            error: null,
          }),
        },
      },
    },
  },
})

mock.module('@/lib/email', {
  namedExports: {
    sendEmail: async (opts: { to: string; subject: string }) => { state.sent.push(opts) },
  },
})

mock.module('@/lib/premium-state-io', { namedExports: { syncPremiumCache: async () => {} } })
mock.module('@/lib/org-premium', { namedExports: { hasActiveOrgPremium: async () => false } })

const { POST } = await import('@/app/api/stripe/webhook/route')

function flush() { return new Promise(resolve => setTimeout(resolve, 20)) }

async function call() {
  const request = new Request('https://quizkanonen.no/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=dummy' },
    body: '{}',
  })
  const res = await POST(request as never)
  await flush()
  return res
}

function updatedEvent(status: string) {
  return {
    id: `evt_upd_${Math.random()}`,
    type: 'customer.subscription.updated',
    data: { object: { id: SUB, customer: CUSTOMER, status, current_period_end: 1800000000, items: { data: [] } } },
  }
}

function deletedEvent() {
  return {
    id: `evt_del_${Math.random()}`,
    type: 'customer.subscription.deleted',
    data: { object: { id: SUB, customer: CUSTOMER, status: 'canceled', cancellation_details: { reason: 'cancellation_requested' } } },
  }
}

const adminMails = (s: typeof state.sent) => s.filter(e => /pause|avsluttet/i.test(e.subject)).map(e => e.to)

const originalError = console.error
beforeEach(() => {
  state.org = {
    id: 'org-elkjop',
    name: 'Elkjøp Nordic',
    slug: 'elkjop',
    stripe_subscription_id: SUB,
    subscription_status: 'active',
  }
  state.members = [
    { user_id: 'admin-1', role: 'admin' },
    { user_id: 'admin-2', role: 'admin' },
    { user_id: 'ansatt-1', role: 'member' },
  ]
  state.emailsById = {
    'admin-1': 'admin1@elkjop.test',
    'admin-2': 'admin2@elkjop.test',
    'ansatt-1': 'ansatt1@elkjop.test',
  }
  state.orgUpdates = []
  state.sent = []
  state.errors = []
  state.stripeSubs = []
  state.listThrows = false
  state.listCalls = 0
  console.error = (...args: unknown[]) => { state.errors.push(args.map(String).join(' ')) }
})

// ── DEL 1: admin varsles ved past_due/unpaid, ikke bare ved deleted ────────

test('past_due låser org → BEGGE admins varsles (før: ingen)', async () => {
  state.event = updatedEvent('past_due')
  await call()
  console.error = originalError

  assert.ok(
    state.orgUpdates.some(u => u.subscription_status === 'locked'),
    'orgen skal låses',
  )
  const toAdmins = state.sent.filter(e => e.subject.includes('satt på pause'))
  assert.deepEqual(
    toAdmins.map(e => e.to).sort(),
    ['admin1@elkjop.test', 'admin2@elkjop.test'],
    'begge admins skal få pause-varselet',
  )
  assert.ok(
    !toAdmins.some(e => /avsluttet/i.test(e.subject)),
    'past_due skal IKKE bruke «avsluttet»-teksten — abonnementet lever',
  )
})

test('past_due varsler også de ansatte, med sin egen tekst', async () => {
  state.event = updatedEvent('past_due')
  await call()
  console.error = originalError

  const toAnsatt = state.sent.filter(e => e.to === 'ansatt1@elkjop.test')
  assert.equal(toAnsatt.length, 1, 'den ansatte skal få nøyaktig én e-post')
  assert.match(toAnsatt[0].subject, /Tilgangen gjennom Elkjøp Nordic/)
})

test('unpaid etter past_due → stille (orgen står allerede som locked)', async () => {
  state.org!.subscription_status = 'locked'
  state.event = updatedEvent('unpaid')
  await call()
  console.error = originalError

  assert.equal(state.sent.length, 0, 'ingen skal varsles to ganger for samme lås')
})

test('canceled via updated sender ingen pause-e-post — deleted-grenen eier den beskjeden', async () => {
  state.event = updatedEvent('canceled')
  await call()
  console.error = originalError

  assert.equal(
    state.sent.filter(e => e.subject.includes('satt på pause')).length, 0,
    'en ekte kansellering skal ikke få «satt på pause»',
  )
})

test('active endrer ingenting og varsler ingen', async () => {
  state.event = updatedEvent('active')
  await call()
  console.error = originalError

  assert.equal(state.sent.length, 0)
})

// ── DEL 2: alle admins, ikke bare den første ───────────────────────────────

test('deleted → alle admins får kanselleringsvarselet (før: kun én)', async () => {
  state.event = deletedEvent()
  await call()
  console.error = originalError

  const cancelled = state.sent.filter(e => e.subject.includes('Bedriftsabonnementet er avsluttet'))
  assert.deepEqual(
    cancelled.map(e => e.to).sort(),
    ['admin1@elkjop.test', 'admin2@elkjop.test'],
  )
})

test('deleted varsler både admins og ansatte, hver med sin tekst', async () => {
  state.event = deletedEvent()
  await call()
  console.error = originalError

  assert.equal(adminMails(state.sent).filter(to => to.startsWith('admin')).length, 2)
  assert.equal(
    state.sent.filter(e => e.to === 'ansatt1@elkjop.test').length, 1,
    'ansatte får ansatt-teksten, ikke admin-teksten',
  )
})

// ── Stale-vakten i updated-grenen (29. juli 2026) ──────────────────────────
// Reaktiveringsracet: org-checkout kansellerer det gamle abonnementet før den
// lager en ny checkout-sesjon. Kommer den gamle updated-hendelsen for sent —
// Stripe-retry eller ute av rekkefølge — matchet den kun på stripe_customer_id
// og låste en org som nettopp hadde betalt.
//
// MUTASJONSBEVIS (verifisert manuelt):
//   * Fjernes vakten (orgVerdict alltid 'process'), feiler «sent updated fra
//     ERSTATTET abonnement …» — orgen låses og hele bedriften får e-post.
//   * Byttes 'ignore' til å også gjelde når det lagrede abonnementet er dødt,
//     feiler «adopsjon …».
//   * Fail-open-grenen (liveSubIds === null → ignore i stedet for process)
//     feiler «Stripe-oppslaget feilet → behandles som før».

const SUB_ERSTATTET = 'sub_gammelt_kansellert'

test('sent updated fra ERSTATTET abonnement låser IKKE en org som lever videre', async () => {
  // Org-en kjører på SUB (nytt, aktivt). Den gamle, kansellerte hendelsen
  // ankommer nå.
  state.stripeSubs = [{ id: SUB, status: 'active' }]
  state.event = updatedEvent('canceled')
  ;(state.event.data as { object: { id: string } }).object.id = SUB_ERSTATTET
  await call()
  console.error = originalError

  assert.equal(state.listCalls, 1, 'ulike id-er skal utløse ett Stripe-oppslag')
  assert.deepEqual(state.orgUpdates, [], 'ingenting skal skrives på org-en')
  assert.equal(state.sent.length, 0, 'hverken ansatte eller admin skal varsles om en feilaktig lås')
})

test('ekte updated fra GJELDENDE abonnement låser fortsatt som normalt', async () => {
  state.event = updatedEvent('past_due')
  await call()
  console.error = originalError

  assert.equal(state.listCalls, 0, 'like id-er skal ikke koste en ekstra rundtur')
  assert.ok(
    state.orgUpdates.some(u => u.subscription_status === 'locked'),
    'en ekte forfalt org skal fortsatt låses',
  )
  assert.ok(state.sent.length > 0, 'og de berørte skal fortsatt varsles')
})

test('adopsjon: lagret abonnement er dødt → hendelsen behandles og id-en rettes', async () => {
  state.org!.stripe_subscription_id = SUB_ERSTATTET
  state.stripeSubs = [{ id: SUB, status: 'active' }]
  state.event = updatedEvent('active')
  await call()
  console.error = originalError

  const upd = state.orgUpdates.at(-1)
  assert.equal(upd?.subscription_status, 'active', 'hendelsen skal behandles')
  assert.equal(upd?.stripe_subscription_id, SUB, 'pekeren skal rettes til det reelle abonnementet')
})

test('Stripe-oppslaget feilet → behandles som før vakten fantes (fail-open)', async () => {
  // Lagret id ≠ hendelsens id, så vakten SKAL slå opp — og oppslaget feiler.
  state.org!.stripe_subscription_id = SUB_ERSTATTET
  state.listThrows = true
  state.event = updatedEvent('past_due')
  await call()
  console.error = originalError

  assert.equal(state.listCalls, 1, 'oppslaget skal faktisk ha vært forsøkt')
  assert.ok(
    state.orgUpdates.some(u => u.subscription_status === 'locked'),
    'usikkerhet skal ikke gjøre oss stille om en mulig ekte forfallelse',
  )
  assert.ok(
    !state.orgUpdates.some(u => 'stripe_subscription_id' in u),
    'uten svar fra Stripe skal pekeren stå urørt — vi adopterer ikke i blinde',
  )
})
