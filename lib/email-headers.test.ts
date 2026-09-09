// Kjøres med:  npm test
//
// List-Unsubscribe på repeterende utsendinger (del C, 9. september 2026).
//
// To ting låses her:
//   1. `sendEmail` sender `headers` VIDERE til Resend — og utelater feltet
//      helt når det ikke er gitt. En transaksjonell e-post skal ikke få en tom
//      eller udefinert `headers`-nøkkel med på kjøpet.
//   2. `listUnsubscribeHeaders()` lager det formatet klienter faktisk leser:
//      URL i vinkelparenteser (RFC 2369) og den eksakte one-click-verdien
//      (RFC 8058). Et avvik her er stille — klienten viser bare ingen knapp.
//
// Hvem som FÅR headeren (repeterende) og hvem som IKKE gjør det
// (transaksjonelle) vaktes av lib/email-signals.test.ts. At URL-en headeren
// peker på faktisk melder av ved one-click-POST vaktes av
// lib/unsubscribe-route.test.ts.
//
// MUTASJONSBEVIS:
//   • `...(headers ? { headers } : {})` fjernet fra sendEmail → «headers
//     sendes videre til Resend» ryker (Resend fikk ingen headers).
//   • Spreaden byttet til `headers,` uten vakt → «uten headers får Resend
//     ingen headers-nøkkel» ryker (nøkkelen finnes, verdi undefined).
//   • Vinkelparentesene fjernet i listUnsubscribeHeaders → formattesten ryker.

import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CRON_SECRET = 'test-cron-secret'

const mottatt: Record<string, unknown>[] = []

mock.module('@/lib/resend-budget', {
  namedExports: { acquireResendSlot: async () => ({ ok: true }) },
})

mock.module('resend', {
  namedExports: {
    Resend: class {
      emails = {
        send: async (args: Record<string, unknown>) => {
          mottatt.push(args)
          return { error: null }
        },
      }
    },
  },
})

mock.module('@sentry/nextjs', {
  namedExports: { captureException: () => {} },
})

const { sendEmail } = await import('@/lib/email')
const { listUnsubscribeHeaders, buildUnsubscribeUrl } = await import('@/lib/unsubscribe')

const BASE = { to: 'mottaker@example.com', subject: 'Quizen er nå åpen', html: '<p>hei</p>' }

beforeEach(() => { mottatt.length = 0 })

test('headers sendes videre til Resend uendret', async () => {
  const headers = { 'List-Unsubscribe': '<https://www.quizkanonen.no/x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  await sendEmail({ ...BASE, headers })

  assert.equal(mottatt.length, 1)
  assert.deepEqual(mottatt[0].headers, headers)
})

test('uten headers får Resend ingen headers-nøkkel i det hele tatt', async () => {
  await sendEmail(BASE)

  assert.equal(mottatt.length, 1)
  assert.equal('headers' in mottatt[0], false,
    'en transaksjonell e-post skal ikke sende en tom/undefined headers-nøkkel')
})

test('listUnsubscribeHeaders: URL i vinkelparenteser + eksakt one-click-verdi', () => {
  const url = 'https://www.quizkanonen.no/api/notifications/unsubscribe?token=abc&type=reminders&uid=42'
  const h = listUnsubscribeHeaders(url)

  assert.deepEqual(Object.keys(h).sort(), ['List-Unsubscribe', 'List-Unsubscribe-Post'])
  assert.equal(h['List-Unsubscribe'], `<${url}>`)
  assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
})

test('headeren bærer NØYAKTIG samme URL som buildUnsubscribeUrl — én vei ut, ikke to', () => {
  const url = buildUnsubscribeUrl('5c312683-2010-46d5-8a9d-a3529ee2e285', 'quiznotify')
  const h = listUnsubscribeHeaders(url)

  assert.equal(h['List-Unsubscribe'].slice(1, -1), url)
  assert.match(url, /^https:\/\/www\.quizkanonen\.no\//, 'avmeldings-URL-en skal peke på www, ikke apex')
})
