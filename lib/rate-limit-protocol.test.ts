// Kjøres med:  npm test
//
// REN logikk — ingen nettverk, ingen env, ingen timere. Alt som har med
// Upstash-protokollen å gjøre er samlet her nettopp for å kunne testes slik.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCounterCommands,
  decideFromCount,
  keyPrefixOf,
  parseCounterResponse,
  redisKeyFor,
  shouldReportFailOpen,
  REDIS_KEY_PREFIX,
} from './rate-limit-protocol'

// ── Kommandoene ─────────────────────────────────────────────────────────────

test('TTL settes i SAMME transaksjon som telleren opprettes', () => {
  // Dette er hele grunnen til at rekkefølgen er SET-før-INCR. Snus den, eller
  // deles den i to kall, kan en nøkkel bli stående uten utløpstid og sperre
  // brukeren for alltid. Testen låser både rekkefølgen og at PX er med.
  const [first, second] = buildCounterCommands('submit:1.2.3.4', 600_000)

  assert.equal(first[0], 'SET')
  assert.equal(first[1], 'rl:submit:1.2.3.4')
  assert.equal(first[2], '0')
  assert.equal(first[3], 'PX')
  assert.equal(first[4], '600000')
  assert.equal(first[5], 'NX')

  assert.deepEqual(second, ['INCR', 'rl:submit:1.2.3.4'])
})

test('NX står på SET — uten den nullstilles vinduet ved hvert kall', () => {
  // Uten NX ville SET skrevet telleren tilbake til 0 hver gang, og grensen
  // ville aldri kunne nås. Det er en stille total-bortfall av bremsen.
  const [set] = buildCounterCommands('k', 1000)
  assert.ok(set.includes('NX'))
})

test('begge kommandoene treffer samme nøkkel, med prefiks', () => {
  const [set, incr] = buildCounterCommands('admin-login:9.9.9.9', 900_000)
  assert.equal(set[1], incr[1])
  assert.ok(set[1].startsWith(REDIS_KEY_PREFIX))
  assert.equal(redisKeyFor('x'), 'rl:x')
})

test('vindu under 1 ms rundes opp til 1 — PX 0 er en syntaksfeil i Redis', () => {
  const [set] = buildCounterCommands('k', 0.4)
  assert.equal(set[4], '1')
})

test('desimaler i vinduet skjæres til heltall', () => {
  const [set] = buildCounterCommands('k', 1500.7)
  assert.equal(set[4], '1500')
})

// ── Tolkning av svaret ──────────────────────────────────────────────────────

test('normalt svar gir tellerstanden fra INCR', () => {
  const parsed = parseCounterResponse([{ result: 'OK' }, { result: 3 }])
  assert.equal(parsed.ok, true)
  assert.equal(parsed.ok === true && parsed.count, 3)
})

test('SET returnerer null når nøkkelen finnes fra før — fortsatt gyldig svar', () => {
  // Andre og senere kall i vinduet: NX slår til, SET gjør ingenting.
  const parsed = parseCounterResponse([{ result: null }, { result: 7 }])
  assert.equal(parsed.ok === true && parsed.count, 7)
})

test('feil på ETT av kommandoene forkaster HELE svaret', () => {
  // MUTASJONSBEVIS: leser man bare json[1].result og ignorerer feilen på
  // json[0], godtas et svar der SET feilet — altså en nøkkel som kan mangle
  // TTL. Da er telleren ikke til å stole på, og en permanent sperre er mulig.
  const setFailed = parseCounterResponse([{ error: 'ERR syntax' }, { result: 2 }])
  assert.equal(setFailed.ok, false)

  const incrFailed = parseCounterResponse([{ result: 'OK' }, { error: 'WRONGTYPE' }])
  assert.equal(incrFailed.ok, false)
})

test('hele transaksjonen forkastet gir ett feilobjekt, ikke en liste', () => {
  const parsed = parseCounterResponse({ error: 'ERR unknown command' })
  assert.equal(parsed.ok, false)
  assert.match(parsed.ok === false ? parsed.reason : '', /unknown command/)
})

test('uventede former avvises i stedet for å tolkes kreativt', () => {
  for (const bad of [null, undefined, [], [{ result: 1 }], 'ok', 42, [{ result: 'OK' }, { result: 'nei' }]]) {
    assert.equal(parseCounterResponse(bad).ok, false, `godtok ${JSON.stringify(bad)}`)
  }
})

// ── Beslutningen ────────────────────────────────────────────────────────────

test('grensen er inklusiv — kall nr. N slipper gjennom, N+1 avvises', () => {
  // Må være IDENTISK med lib/rate-limit.ts, ellers oppfører en rute seg
  // forskjellig avhengig av om Upstash svarte eller ikke.
  assert.deepEqual(decideFromCount(1, 5), { success: true, remaining: 4 })
  assert.deepEqual(decideFromCount(5, 5), { success: true, remaining: 0 })
  assert.deepEqual(decideFromCount(6, 5), { success: false, remaining: 0 })
})

test('remaining går aldri under null', () => {
  assert.equal(decideFromCount(99, 5).remaining, 0)
})

// ── Bremsen på fail-open-rapportering ───────────────────────────────────────

test('første fail-open rapporteres alltid', () => {
  assert.equal(shouldReportFailOpen(1_000, null), true)
})

test('gjentatte fail-open innen intervallet rapporteres ikke', () => {
  // Et Upstash-utfall under en fredagsquiz treffer hver eneste forespørsel.
  // Uten denne bremsen brenner ett utfall hele Sentry-kvoten.
  assert.equal(shouldReportFailOpen(1_000, 1_000, 60_000), false)
  assert.equal(shouldReportFailOpen(60_999, 1_000, 60_000), false)
})

test('etter intervallet rapporteres det igjen', () => {
  assert.equal(shouldReportFailOpen(61_000, 1_000, 60_000), true)
})

// ── Nøkkelprefiks til Sentry ────────────────────────────────────────────────

test('kun delen før kolon eksponeres — IP og bruker-id blir igjen', () => {
  // lib/sentry-scrub.ts fanger headere og kjente mønstre, ikke en vilkårlig
  // streng vi selv legger i `extra`. Derfor må adressen aldri dit.
  assert.equal(keyPrefixOf('submit:81.166.20.4'), 'submit')
  assert.equal(keyPrefixOf('send-invite-user:5c312683-2010-46d5-8a9d-a3529ee2e285'), 'send-invite-user')
  assert.equal(keyPrefixOf('live-ranking:1.2.3.4:quiz-id'), 'live-ranking')
  assert.equal(keyPrefixOf('uten-kolon'), 'uten-kolon')
})
