// Kjøres med:  npm test
//
// Vokter nøkkel-avledningen for spillestien (funn F1, 5. august 2026).
// Ren logikk, ingen I/O — rutebeviset ligger i lib/play-rate-limit-route.test.ts.
//
// MUTASJONSBEVIS
//   • Skriv om playRateLimitKey til å ignorere userId (`${route}:${ip}`, den
//     gamle implementasjonen), og «to innloggede bak SAMME IP …» ryker
//     umiddelbart — de to nøklene blir like.
//   • Legg userId i nøkkelen FØR rute-prefikset, og «prefikset overlever
//     keyPrefixOf …» ryker: bruker-id-en ville da lekket til Sentry.
//   • La ugyldig token falle tilbake på en påstått bruker-id i stedet for null,
//     og «ugyldig token havner i den STRENGE anon-bøtta» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAY_PRE_AUTH_BURST, PLAY_RATE_LIMIT, playRateLimitKey } from '@/lib/play-rate-limit'
import { keyPrefixOf } from '@/lib/rate-limit-protocol'

const IP = '203.0.113.7'

// ── Kjernen i F1: én IP er ikke én person ───────────────────────────────────

test('to innloggede bak SAMME IP får ULIKE nøkler — det er hele poenget med F1', () => {
  const a = playRateLimitKey('start-attempt', 'user-anna', IP)
  const b = playRateLimitKey('start-attempt', 'user-bjorn', IP)

  assert.notEqual(a, b, 'Elkjøp-scenarioet: kolleger skal ikke spise hverandres kvote')
  assert.equal(a, 'start-attempt:user:user-anna')
  assert.equal(b, 'start-attempt:user:user-bjorn')
})

test('samme bruker fra ULIKE IP-er får SAMME nøkkel — kvoten følger personen', () => {
  // Mobil som bytter mellom wifi og 4G midt i en quiz skal ikke få dobbel kvote,
  // og skal heller ikke starte på nytt i en fersk bøtte.
  assert.equal(
    playRateLimitKey('submit', 'user-anna', '203.0.113.7'),
    playRateLimitKey('submit', 'user-anna', '198.51.100.9'),
  )
})

test('ugyldig/manglende token havner i den STRENGE anon-bøtta, nøklet på IP', () => {
  // userId er ALLTID resultatet av et verifisert oppslag. Null betyr «ingen
  // verifisert identitet» — da er IP det eneste vi har, og grensen skal bite.
  assert.equal(playRateLimitKey('start-attempt', null, IP), 'start-attempt:anon:203.0.113.7')
  assert.equal(playRateLimitKey('submit', null, IP), 'submit:anon:203.0.113.7')
})

test('to anonyme bak samme IP DELER nøkkel — den flaten er fortsatt IP-begrenset', () => {
  // Bevisst: uten user_id finnes ingen unik indeks som begrenser
  // radopprettelse, så det er nettopp her grensen må gjøre jobben.
  assert.equal(
    playRateLimitKey('start-attempt', null, IP),
    playRateLimitKey('start-attempt', null, IP),
  )
})

// ── Rutene deler ikke bøtte med hverandre ───────────────────────────────────

test('start-attempt og submit teller hver for seg, også for samme bruker', () => {
  assert.notEqual(
    playRateLimitKey('start-attempt', 'user-anna', IP),
    playRateLimitKey('submit', 'user-anna', IP),
  )
})

// ── Personvern: hva som havner i Sentry ved fail-open ───────────────────────

test('prefikset overlever keyPrefixOf — verken IP eller bruker-id lekker til Sentry', () => {
  // rate-limit-shared sender KUN keyPrefixOf(key) videre i `extra`, og
  // sentry-scrub fanger ikke vilkårlige verdier der. Derfor må alt etter første
  // kolon være det vi er villige til å miste.
  for (const key of [
    playRateLimitKey('start-attempt', 'user-anna', IP),
    playRateLimitKey('start-attempt', null, IP),
    playRateLimitKey('submit', 'user-anna', IP),
    playRateLimitKey('submit', null, IP),
  ]) {
    const prefix = keyPrefixOf(key)
    assert.ok(prefix === 'start-attempt' || prefix === 'submit', `uventet prefiks: ${prefix}`)
    assert.ok(!prefix.includes(IP), 'IP skal ikke være i prefikset')
    assert.ok(!prefix.includes('user-anna'), 'bruker-id skal ikke være i prefikset')
  }
})

// ── Grensene ────────────────────────────────────────────────────────────────

test('lag 1 er romsligere enn lag 2, og har kortere vindu', () => {
  // Lag 1 er en burst-brems foran et GoTrue-oppslag, ikke den ekte grensen.
  // Var den strengere eller like streng som lag 2, ville lag 2 aldri blitt nådd
  // og hele per-bruker-nøklingen vært virkningsløs.
  assert.ok(
    PLAY_PRE_AUTH_BURST.limit > PLAY_RATE_LIMIT.limit,
    'lag 1 må slippe gjennom mer enn lag 2, ellers er lag 2 dødkode',
  )
  assert.ok(
    PLAY_PRE_AUTH_BURST.windowMs < PLAY_RATE_LIMIT.windowMs,
    'lag 1 skal låse ute i sekunder, ikke i minutter',
  )
})

test('lag 1 rommer et kontornett på 40 spillere med tre kall hver', () => {
  // Elkjøp Nordic har 29 medlemmer. Taket skal ikke kunne treffes av normal
  // bruk fra det største nettet vi kjenner, med god margin.
  assert.ok(PLAY_PRE_AUTH_BURST.limit >= 40 * 3)
})
