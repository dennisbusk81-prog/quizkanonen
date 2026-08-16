// Kjøres med:  npm test
//
// GATEN i sendEmail: hver eneste sending skal skaffe seg en plass i det delte
// Resend-budsjettet (lib/resend-budget.ts) FØR Resend-kallet går av gårde.
//
// Dette er koblingstesten — lib/resend-budget.test.ts beviser at budsjettet
// virker, denne beviser at sendEmail faktisk BRUKER det. Uten den kunne gaten
// fjernes fra sendEmail uten at én test ble rød (samme hull som beskrevet for
// middleware-cookie-guard i CLAUDE.md).
//
// MUTASJONSBEVIS (kjørt 16. august 2026):
//   • `await acquireResendSlot()` fjernet fra sendEmail → «gaten kalles før
//     Resend-kallet» ryker (rekkefølgen mangler 'gate'), og «fullt budsjett
//     stopper sendingen» ryker (Resend-kallet gikk likevel).
//   • `if (!slot.ok) …throw` fjernet (gaten kalles, men utfallet ignoreres) →
//     «fullt budsjett stopper sendingen» ryker: Resend-kallet gikk likevel.
//   • `throw err` fjernet fra gave-opp-grenen → «feilformen er den samme som
//     ved et Resend-429» ryker: promiset resolver.

import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const rekkefølge: string[] = []
let budsjettSvar: { ok: boolean } = { ok: true }
const captured: { err: unknown; ctx: { extra?: Record<string, unknown> } }[] = []

mock.module('@/lib/resend-budget', {
  namedExports: {
    acquireResendSlot: async () => {
      rekkefølge.push('gate')
      return budsjettSvar
    },
  },
})

mock.module('resend', {
  namedExports: {
    Resend: class {
      emails = {
        send: async () => {
          rekkefølge.push('send')
          return { error: null }
        },
      }
    },
  },
})

mock.module('@sentry/nextjs', {
  namedExports: {
    captureException: (err: unknown, ctx: { extra?: Record<string, unknown> }) => {
      captured.push({ err, ctx })
    },
  },
})

const { sendEmail } = await import('@/lib/email')

const OPTS = {
  to: 'mottaker@example.com',
  subject: 'Fredagsquizen er nå åpen',
  html: '<p>hei</p>',
}

beforeEach(() => {
  rekkefølge.length = 0
  captured.length = 0
  budsjettSvar = { ok: true }
})

test('gaten kalles FØR Resend-kallet — hver gang', async () => {
  await sendEmail(OPTS)

  assert.deepEqual(rekkefølge, ['gate', 'send'],
    'reservasjonen må skje før forespørselen — etterpå er den meningsløs')
})

test('fullt budsjett stopper sendingen: Resend kalles ALDRI', async () => {
  budsjettSvar = { ok: false }

  await assert.rejects(() => sendEmail(OPTS), /Failed to send email/)

  assert.deepEqual(rekkefølge, ['gate'],
    'Resend-kallet gikk selv om budsjettet sa nei — da er gaten pynt')
})

test('feilformen ved oppgitt budsjett er den samme som ved et Resend-429', async () => {
  // Kallernes håndtering (ikke stemple, prøv neste kjøring) er skrevet mot
  // «Failed to send email: …»-feil som kastes. Gave-opp-grenen må ha samme
  // form, ellers oppfører rutene seg annerledes avhengig av om avvisningen
  // kom fra Resend eller fra vårt eget budsjett.
  budsjettSvar = { ok: false }

  let fanget: unknown = null
  await sendEmail(OPTS).catch(err => { fanget = err })

  assert.ok(fanget instanceof Error)
  assert.match((fanget as Error).message, /^Failed to send email/)
  // …og den rapporteres til Sentry, med kilde, uten mottakeradresse.
  assert.equal(captured.length, 1)
  assert.equal(captured[0].ctx.extra?.kilde, 'resend-budsjett gav opp')
  assert.ok(!JSON.stringify(captured[0].ctx).includes(OPTS.to))
})

test('ok fra budsjettet → sendingen går som normalt, ingenting rapporteres', async () => {
  await sendEmail(OPTS)

  assert.equal(captured.length, 0)
})
