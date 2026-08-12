// Kjøres med:  npm test
//
// reportMoneyPathFailure — varselet på pengestier som ellers er helt stille.
//
// BAKGRUNN (12. august 2026)
// `/api/codes/redeem` pauser abonnementet til en betalende kunde som løser inn
// en verdikode. Feilet pausen, ble koden likevel gitt (riktig), og det eneste
// sporet var en `console.error`. Sentry har ingen captureConsole-integrasjon, så
// varselet nådde ingen — kunden ble trukket kr 49 for en gratismåned, og den
// eneste som kunne meldt fra var kunden selv.
//
// HVA TESTENE VOKTER
//  1. At et varsel faktisk sendes, med tag og nivå som gjør det mulig å lage
//     en Sentry-regel på det.
//  2. At grupperingen følger OPERASJONEN og ikke feilteksten — ellers blir hver
//     Stripe-feilvariant en ny sak i stedet for en teller på den samme.
//  3. At et PostgrestError (`{ message, code }`, IKKE en Error-instans) beholder
//     meldingen sin. `String(obj)` gir «[object Object]», altså et varsel uten
//     innhold — og det er nøyaktig formen change-plan sender.
//  4. At funksjonen ALDRI kaster. Kallstedene har allerede bestemt seg for å
//     fortsette; en innløsning som gikk gjennom skal ikke kunne rulle tilbake
//     fordi Sentry er nede.
//  5. At `consequence` — teksten som forteller hva som skjer med pengene —
//     alltid er med.
//
// MUTASJONSBEVIS (kjørt 12. august 2026, se rapporten): hver mutasjon under ble
// faktisk lagt inn i lib/money-path-alert.ts, `npm test` kjørt, og linja rullet
// tilbake igjen.
//   • captureMessage-kallet fjernet             → test 1, 2, 3, 5 ryker
//   • level: 'error' → 'info'                   → «nivå og tag» ryker
//   • operation ute av meldingsstrengen
//     (`captureMessage('money-path')`)          → «grupperes på operasjonen» ryker
//   • describeError: objekt-grenen fjernet      → «PostgrestError beholder meldingen» ryker
//   • try/catch rundt kroppen fjernet           → «kaster aldri» ryker
//   • consequence utelatt fra extra             → «konsekvensen følger med» ryker

import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type Capture = {
  message: string
  ctx: { level?: string; tags?: Record<string, string>; extra?: Record<string, unknown> }
}
const captured: Capture[] = []

// Settes per test: lar oss simulere at Sentry selv er nede.
let captureOppførsel: (message: string, ctx: Capture['ctx']) => void = (message, ctx) => {
  captured.push({ message, ctx })
}

mock.module('@sentry/nextjs', {
  namedExports: {
    captureMessage: (message: string, ctx: Capture['ctx']) => captureOppførsel(message, ctx),
  },
})

const { reportMoneyPathFailure } = await import('@/lib/money-path-alert')

const PAUSE_FEILET = {
  operation: 'codes/redeem:pause-subscription',
  consequence: 'Kunden trekkes kr 49 for en periode de fikk gratis via verdikode.',
  err: new Error('No such subscription: sub_123'),
  context: { subscriptionId: 'sub_123', userId: 'u-1', resumesAt: '2026-10-08T08:43:04.000Z' },
}

beforeEach(() => {
  captured.length = 0
  captureOppførsel = (message, ctx) => { captured.push({ message, ctx }) }
})

test('en feilet pause sendes til Sentry med nivå og tag som kan lages regel på', () => {
  reportMoneyPathFailure(PAUSE_FEILET)

  assert.equal(captured.length, 1, 'pengesti-feilen forble stille')
  assert.equal(captured[0].ctx.level, 'error')
  assert.equal(captured[0].ctx.tags?.area, 'money-path')
  assert.equal(captured[0].ctx.tags?.operation, 'codes/redeem:pause-subscription')
})

test('grupperingen følger OPERASJONEN, ikke feilteksten', () => {
  reportMoneyPathFailure(PAUSE_FEILET)
  reportMoneyPathFailure({ ...PAUSE_FEILET, err: new Error('Request timed out') })

  // Samme meldingsstreng ⇒ Sentry teller dem som én sak. Lå feilteksten i
  // meldingen, ville hver Stripe-feilvariant blitt en ny sak å overse.
  assert.equal(captured[0].message, captured[1].message)
  assert.match(captured[0].message, /codes\/redeem:pause-subscription/)

  // …men den konkrete feilen skal fortsatt være å finne inne i saken.
  assert.equal(captured[0].ctx.extra?.errorMessage, 'No such subscription: sub_123')
  assert.equal(captured[1].ctx.extra?.errorMessage, 'Request timed out')
})

test('konsekvensen for pengene følger alltid med', () => {
  reportMoneyPathFailure(PAUSE_FEILET)

  assert.equal(captured[0].ctx.extra?.consequence, PAUSE_FEILET.consequence)
})

test('identifikatorene som trengs for å rette opp manuelt er med', () => {
  reportMoneyPathFailure(PAUSE_FEILET)

  assert.equal(captured[0].ctx.extra?.subscriptionId, 'sub_123')
  assert.equal(captured[0].ctx.extra?.userId, 'u-1')
  assert.equal(captured[0].ctx.extra?.resumesAt, '2026-10-08T08:43:04.000Z')
})

test('PostgrestError beholder meldingen sin — ikke «[object Object]»', () => {
  // Nøyaktig formen change-plan sender: et rått Supabase-feilobjekt, ikke en
  // Error-instans. Uten objekt-grenen i describeError blir varselet innholdsløst.
  reportMoneyPathFailure({
    operation: 'change-plan:persist-plan',
    consequence: 'Kunden er fakturert for ny plan, men kolonnen står på den gamle.',
    err: { message: 'could not connect to server', code: '08006' },
    context: { orgId: 'org-1' },
  })

  assert.equal(captured[0].ctx.extra?.errorMessage, 'could not connect to server')
  assert.equal(captured[0].ctx.extra?.errorCode, '08006')
  assert.ok(
    !JSON.stringify(captured[0].ctx).includes('[object Object]'),
    'feilen ble stringifisert til «[object Object]» — varselet er uten innhold',
  )
})

test('en Error beholder navnet sitt', () => {
  class StripeInvalidRequestError extends Error {
    constructor(msg: string) { super(msg); this.name = 'StripeInvalidRequestError' }
  }
  reportMoneyPathFailure({
    ...PAUSE_FEILET,
    err: new StripeInvalidRequestError('No such subscription'),
  })

  assert.equal(captured[0].ctx.extra?.errorName, 'StripeInvalidRequestError')
})

test('uten feil (kun kontekst) sendes varselet likevel', () => {
  // webhook/checkout:missing-user-id og webhook/refund:no-customer har ingen
  // kastet feil — de er tilstander, ikke unntak. De skal varsle like fullt.
  reportMoneyPathFailure({
    operation: 'webhook/checkout:missing-user-id',
    consequence: 'Kunden HAR betalt, men får aldri Premium.',
    context: { sessionId: 'cs_1' },
  })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].ctx.extra?.errorMessage, undefined)
  assert.equal(captured[0].ctx.extra?.sessionId, 'cs_1')
})

test('KASTER ALDRI — en nede Sentry skal ikke velte en innløsning som gikk gjennom', () => {
  captureOppførsel = () => { throw new Error('Sentry transport er nede') }

  assert.doesNotThrow(
    () => reportMoneyPathFailure(PAUSE_FEILET),
    'rapportering kastet videre — kallstedet ville avbrutt en pengesti som skal fortsette',
  )
})
