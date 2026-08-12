// Kjøres med:  npm test
//
// sendEmail rapporterer e-postfeil til Sentry — ved SINKET, ikke hos kallerne.
//
// BAKGRUNN (12. august 2026)
// En aktivering av prøveperioden gikk gjennom, men trialWelcomeEmail feilet med
// «API key is invalid». Brukeren fikk ingen e-post, og det eneste sporet var en
// `console.error` i serverloggen — usynlig i prod.
//
// Feilen hadde 24 søsken: alle 25 kallsteder for sendEmail svelger feilen på
// samme måte (11 med fire-and-forget `.catch`, resten med await i try/catch).
// Ingen av dem rapporterte noe sted. Derfor ligger rapporteringen i
// lib/email.ts — samme sted som escapingen bor i email-templates.ts og
// skrubbingen i sentry-scrub.ts. Et 26. kallsted arver den gratis.
//
// HVA TESTENE VOKTER
//  1. At en Resend-`error` rapporteres OG fortsatt kastes (fire-and-forget hos
//     kallerne skal være uendret — aktiveringen skal ikke begynne å feile).
//  2. At en KASTET feil (nettverk/timeout — den vanligste driftsfeilen) også
//     rapporteres. Uten den grenen ville det vanligste tilfellet vært det ene
//     som forble stille.
//  3. At en vellykket sending ikke rapporterer noe.
//  4. At mottakeradressen ALDRI havner i Sentry-nyttelasten.
//
// MUTASJONSBEVIS (alle kjørt 12. august 2026 — se rapporten):
//   • captureException fjernet fra error-grenen → «Resend-error rapporteres» ryker
//   • try/catch rundt resend.emails.send fjernet → «kastet feil rapporteres» ryker
//   • `to` lagt inn i extra → «adressen lekker aldri» ryker
//   • rapportering flyttet før if(error), altså alltid → «suksess rapporterer
//     ingenting» ryker
//   • `throw` fjernet etter rapporteringen → «feilen kastes fortsatt» ryker

import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

type Capture = { err: unknown; ctx: { tags?: Record<string, string>; extra?: Record<string, unknown> } }
const captured: Capture[] = []

// Resend-oppførselen styres per test.
let sendOppførsel: () => Promise<{ error: { message: string; name?: string } | null }>

mock.module('resend', {
  namedExports: {
    Resend: class {
      emails = { send: () => sendOppførsel() }
      domains = { list: async () => ({ data: null, error: null }) }
    },
  },
})

mock.module('@sentry/nextjs', {
  namedExports: {
    captureException: (err: unknown, ctx: Capture['ctx']) => { captured.push({ err, ctx }) },
  },
})

const { sendEmail } = await import('@/lib/email')

const OPTS = {
  to: 'dennisbusk81+trial1@gmail.com',
  subject: 'Prøveperioden din er i gang — Quizkanonen',
  html: '<p>hei</p>',
}

beforeEach(() => { captured.length = 0 })

test('Resend svarer med error → rapporteres til Sentry', async () => {
  sendOppførsel = async () => ({ error: { message: 'API key is invalid', name: 'validation_error' } })

  await assert.rejects(() => sendEmail(OPTS), /API key is invalid/)

  assert.equal(captured.length, 1, 'e-postfeilen ble ikke rapportert')
  assert.equal(captured[0].ctx.tags?.area, 'email')
  assert.equal(captured[0].ctx.extra?.subject, OPTS.subject)
  assert.equal(captured[0].ctx.extra?.resendError, 'validation_error')
})

test('feilen KASTES fortsatt — fire-and-forget hos kallerne er uendret', async () => {
  sendOppførsel = async () => ({ error: { message: 'API key is invalid' } })

  // Nøyaktig mønsteret i founders-activate: .catch skal fange, og koden rundt
  // skal fortsette. Aktiveringen må ikke begynne å feile av en e-post.
  let fanget: unknown = null
  await sendEmail(OPTS).catch(err => { fanget = err })

  assert.ok(fanget instanceof Error, 'sendEmail sluttet å kaste — kallernes .catch fyrer ikke lenger')
  assert.match((fanget as Error).message, /Failed to send email/)
  assert.equal(captured.length, 1)
})

test('resend.emails.send KASTER (nettverk/timeout) → rapporteres og kastes videre', async () => {
  const nettverksfeil = new Error('fetch failed')
  sendOppførsel = async () => { throw nettverksfeil }

  await assert.rejects(() => sendEmail(OPTS), /fetch failed/)

  assert.equal(captured.length, 1, 'en kastet feil forble stille')
  assert.equal(captured[0].err, nettverksfeil, 'den opprinnelige feilen ble ikke sendt videre')
  assert.equal(captured[0].ctx.extra?.kilde, 'resend.emails.send kastet')
})

test('vellykket sending rapporterer ingenting', async () => {
  sendOppførsel = async () => ({ error: null })

  await sendEmail(OPTS)

  assert.equal(captured.length, 0, 'en vellykket sending støyet i Sentry')
})

test('mottakeradressen havner ALDRI i Sentry-nyttelasten', async () => {
  sendOppførsel = async () => ({ error: { message: 'API key is invalid' } })
  await sendEmail(OPTS).catch(() => {})

  const nyttelast = JSON.stringify(captured[0].ctx)
  assert.ok(!nyttelast.includes(OPTS.to), 'mottakeradressen ble sendt til Sentry')
  assert.ok(!/@/.test(nyttelast), `noe som ligner en e-postadresse lekket: ${nyttelast}`)
  // …men emnet SKAL være der. Det er den raskeste måten å se hvilken e-post
  // som feilet, og det er vår egen tekst.
  assert.ok(nyttelast.includes('Prøveperioden din er i gang'))
})

test('html-innholdet sendes heller ikke med', async () => {
  sendOppførsel = async () => ({ error: { message: 'boom' } })
  await sendEmail({ ...OPTS, html: '<p>HEMMELIG_MARKØR</p>' }).catch(() => {})

  assert.ok(!JSON.stringify(captured[0].ctx).includes('HEMMELIG_MARKØR'),
    'hele e-postkroppen ble sendt til Sentry')
})
