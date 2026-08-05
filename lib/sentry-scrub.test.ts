import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  REDACTED,
  collectSecretValues,
  scrubText,
  scrubUrl,
  scrubEvent,
} from './sentry-scrub'

// ── scrubText ────────────────────────────────────────────────────────────────

test('scrubText fjerner e-postadresser midt i en setning', () => {
  const out = scrubText('Kunne ikke sende invitasjon til dennis@quizkanonen.no (ugyldig)')
  assert.equal(out, `Kunne ikke sende invitasjon til ${REDACTED} (ugyldig)`)
})

test('scrubText fjerner JWT — som dekker Supabase-nøkler og access_token', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  assert.equal(scrubText(`token=${jwt} feilet`), `token=${REDACTED} feilet`)
})

test('scrubText fjerner Stripe live-nøkler', () => {
  const out = scrubText('Stripe avviste sk_live_51QabcdefGHIJKLmnop')
  assert.equal(out, `Stripe avviste ${REDACTED}`)
})

test('scrubText fjerner Bearer-token uansett bokstavstørrelse', () => {
  assert.equal(scrubText('bearer abcdef1234567890'), REDACTED)
})

test('scrubText fjerner bokstavelige hemmeligheter fra miljøet', () => {
  const secret = 'kanonhemmelig-cron-verdi-123'
  const out = scrubText(`CRON_SECRET mismatch: ${secret}`, [secret])
  assert.equal(out, `CRON_SECRET mismatch: ${REDACTED}`)
})

test('scrubText lar ordinær feiltekst stå urørt', () => {
  const msg = 'Forsøket er allerede levert'
  assert.equal(scrubText(msg, ['en-annen-hemmelighet']), msg)
})

// Regresjonsvakt: en kort hemmelighet som er prefiks av en lang må ikke få
// skrubbe halve den lange og etterlate resten i klartekst.
test('lengste hemmelighet skrubbes først når én er prefiks av en annen', () => {
  const short = 'abcdefgh'
  const long = 'abcdefgh-ijklmnop-qrstuvwx'
  const secrets = collectSecretValues({ CRON_SECRET: short, ADMIN_PASSWORD: long })
  assert.equal(scrubText(`verdi=${long}`, secrets), `verdi=${REDACTED}`)
})

// ── collectSecretValues ──────────────────────────────────────────────────────

test('collectSecretValues hopper over tomme og for korte verdier', () => {
  const out = collectSecretValues({
    CRON_SECRET: 'kort',
    ADMIN_PASSWORD: '',
    STRIPE_SECRET_KEY: 'sk_live_langnokverdi',
    NEXT_PUBLIC_SUPABASE_URL: 'https://eksempel.supabase.co',
  })
  assert.deepEqual(out, ['sk_live_langnokverdi'])
})

// ── scrubUrl ─────────────────────────────────────────────────────────────────

test('scrubUrl skrubber hemmelige query-verdier, men beholder nøkkelen', () => {
  const out = scrubUrl('https://quizkanonen.no/avmelding?token=hemmelig123&id=42')
  assert.ok(out.includes(`token=${encodeURIComponent(REDACTED)}`), out)
  assert.ok(out.includes('id=42'), out)
})

test('scrubUrl skrubber invitasjons-token som ligger i STIEN', () => {
  const out = scrubUrl('https://quizkanonen.no/api/org/join/abc123hemmelig')
  assert.ok(!out.includes('abc123hemmelig'), out)
  assert.ok(out.includes('/api/org/join/'), out)
})

test('scrubUrl håndterer relativ sti uten å finne på et opphav', () => {
  const out = scrubUrl('/api/quiz/12/submit?code=xyz98765')
  assert.ok(out.startsWith('/api/quiz/12/submit'), out)
  assert.ok(!out.includes('xyz98765'), out)
  assert.ok(!out.includes('placeholder.invalid'), out)
})

// ── scrubEvent ───────────────────────────────────────────────────────────────

test('scrubEvent tømmer sensitive headere og beholder ufarlige', () => {
  const event = scrubEvent({
    request: {
      url: 'https://quizkanonen.no/api/profile/upsert',
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
        'x-attempt-token': '1754300000000.signatur',
        'x-forwarded-for': '81.2.3.4',
        'user-agent': 'Mozilla/5.0',
      },
    },
  })
  assert.equal(event.request!.headers!.authorization, REDACTED)
  assert.equal(event.request!.headers!['x-attempt-token'], REDACTED)
  assert.equal(event.request!.headers!['x-forwarded-for'], REDACTED)
  assert.equal(event.request!.headers!['user-agent'], 'Mozilla/5.0')
})

test('scrubEvent skrubber exception-verdier og breadcrumb-tekst', () => {
  const event = scrubEvent({
    exception: { values: [{ value: 'Fant ikke bruker kari@eksempel.no' }] },
    breadcrumbs: [{ message: 'POST /api/org/send-invite for ola@eksempel.no' }],
  })
  assert.equal(event.exception!.values![0].value, `Fant ikke bruker ${REDACTED}`)
  assert.ok(!event.breadcrumbs![0].message!.includes('ola@eksempel.no'))
})

test('scrubEvent fjerner e-post, brukernavn og IP fra brukerkontekst', () => {
  const event = scrubEvent({
    user: { email: 'dennis@quizkanonen.no', username: 'Dennis', ip_address: '81.2.3.4' },
  })
  assert.deepEqual(event.user, {})
})

test('scrubEvent beholder user.id — sporbarhet uten personopplysning', () => {
  const event: { user: Record<string, unknown> } = {
    user: { id: '9f1c-uuid', email: 'dennis@quizkanonen.no' },
  }
  scrubEvent(event)
  assert.equal(event.user.id, '9f1c-uuid')
  assert.equal(event.user.email, undefined)
})

test('scrubEvent går rekursivt gjennom extra og skrubber på nøkkelnavn', () => {
  const event = scrubEvent({
    extra: {
      payload: { email: 'kari@eksempel.no', nested: { token: 'hemmelig' }, antall: 3 },
    },
  })
  const payload = (event.extra!.payload as Record<string, unknown>)
  assert.equal(payload.email, REDACTED)
  assert.equal((payload.nested as Record<string, unknown>).token, REDACTED)
  assert.equal(payload.antall, 3)
})

test('scrubEvent muterer og returnerer det samme objektet', () => {
  const event = { message: 'hei kari@eksempel.no' }
  assert.equal(scrubEvent(event), event)
  assert.equal(event.message, `hei ${REDACTED}`)
})

test('scrubEvent takler et tomt event uten å kaste', () => {
  assert.doesNotThrow(() => scrubEvent({}))
})
