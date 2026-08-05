// Kjøres med:  npm test
//
// Vokter ÉN egenskap: en 429-logglinje skal aldri kunne bære IP-adresse eller
// bruker-id — selv om funksjonen med vilje får HELE rate-limit-nøkkelen inn.
//
// Nøklene ser slik ut, og alle tre bærer noe vi ikke vil logge:
//     start-attempt:user:<uuid>
//     submit:anon:<ip>
//     live-ranking:<ip>:<quizId>
//
// En Vercel-logglinje skrubbes ikke av noe (lib/sentry-scrub.ts gjelder bare
// det som sendes til Sentry), så rensingen MÅ skje ved sinket. Derfor tar
// logRateLimitHit nøkkelen og skreller den selv i stedet for å ta et ferdig
// prefiks — da er det strukturelt umulig for en kaller å sende inn for mye.
//
// MUTASJONSBEVIS
//   • Bytt `rute: keyPrefixOf(key)` til `rute: key`, og BEGGE
//     lekkasje-testene ryker.
//   • Fjern `lag`-feltet, og «lag skiller de to lagene …» ryker — uten det
//     kan ingen se om det var burst-bremsen eller den ekte grensen som bet,
//     siden prefikset er identisk for begge.
//   • Bytt `innlogget: boolean` til å logge selve id-en, og
//     «innlogget er boolsk …» ryker.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { logRateLimitHit, RATE_LIMIT_HIT_MARKER } from '@/lib/rate-limit-log'

const IP = '203.0.113.7'
const BRUKER = '11111111-1111-4111-8111-111111111111'
const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let linjer: unknown[][] = []
const ekteWarn = console.warn

beforeEach(() => {
  linjer = []
  console.warn = (...args: unknown[]) => { linjer.push(args) }
})
afterEach(() => { console.warn = ekteWarn })

/** Alt som faktisk havner i loggen, som én streng. */
function loggtekst(): string {
  return linjer.map(a => a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')).join('\n')
}

// ── Positiv kontroll: linjen finnes og er søkbar ────────────────────────────

test('logger med den søkbare markøren og rute-prefikset', () => {
  logRateLimitHit(`start-attempt:user:${BRUKER}`, {
    lag: 'delt', limit: 20, windowMs: 600_000, innlogget: true,
  })

  assert.equal(linjer.length, 1)
  assert.equal(linjer[0][0], RATE_LIMIT_HIT_MARKER, 'markøren må stå først så grep finner den')
  const t = loggtekst()
  assert.match(t, /start-attempt/, 'ruten må være med, ellers er linjen ubrukelig')
  assert.match(t, /20\/600s/, 'grensen som bet')
})

// ── KJERNEN: ingenting personidentifiserende slipper ut ─────────────────────

test('LEKKASJE: bruker-id fra nøkkelen kommer ALDRI med i loggen', () => {
  logRateLimitHit(`start-attempt:user:${BRUKER}`, {
    lag: 'delt', limit: 20, windowMs: 600_000, innlogget: true,
  })

  assert.ok(!loggtekst().includes(BRUKER), 'bruker-id skal aldri logges')
})

test('LEKKASJE: IP fra nøkkelen kommer ALDRI med i loggen', () => {
  // Alle tre nøkkelformene som bærer en IP.
  logRateLimitHit(`submit:anon:${IP}`, { lag: 'delt', limit: 20, windowMs: 600_000, innlogget: false })
  logRateLimitHit(`submit:pre:${IP}`, { lag: 'burst', limit: 120, windowMs: 60_000 })
  logRateLimitHit(`live-ranking:${IP}:${QUIZ}`, { lag: 'lokal', limit: 30, windowMs: 60_000, quizId: QUIZ })

  assert.equal(linjer.length, 3)
  assert.ok(!loggtekst().includes(IP), 'IP skal aldri logges, uansett nøkkelform')
})

test('live-ranking-nøkkelen skreller bort IP-en som står MIDT i nøkkelen', () => {
  // Verdt en egen test: her ligger IP-en mellom to kolon, ikke sist. En
  // «fjern siste ledd»-implementasjon ville sluppet den gjennom.
  logRateLimitHit(`live-ranking:${IP}:${QUIZ}`, { lag: 'lokal', limit: 30, windowMs: 60_000 })

  const t = loggtekst()
  assert.match(t, /live-ranking/)
  assert.ok(!t.includes(IP))
})

// ── Feltene som gjør linjen handlingsbar ────────────────────────────────────

test('lag skiller de to lagene — prefikset er identisk for begge', () => {
  logRateLimitHit(`start-attempt:pre:${IP}`, { lag: 'burst', limit: 120, windowMs: 60_000 })
  logRateLimitHit(`start-attempt:user:${BRUKER}`, { lag: 'delt', limit: 20, windowMs: 600_000 })

  const t = loggtekst()
  assert.match(t, /burst/, 'uten dette kan ingen se hvilket lag som bet')
  assert.match(t, /delt/)
})

test('innlogget er BOOLSK — skiller ekte spiller fra anonym trafikk', () => {
  // En avvist innlogget spiller er alarmerende; anonym trafikk mot taket er
  // forventet. Skillet må kunne leses uten at id-en logges.
  logRateLimitHit(`submit:user:${BRUKER}`, {
    lag: 'delt', limit: 20, windowMs: 600_000, innlogget: true,
  })

  const felt = linjer[0][1] as Record<string, unknown>
  assert.equal(felt.innlogget, true)
  assert.ok(!loggtekst().includes(BRUKER))
})

test('quizId LOGGES — offentlig identifikator, og den mest nyttige konteksten', () => {
  // Står i hver eneste offentlige URL (/quiz/<id>), altså ikke personopplysning.
  // Uten den kan vi ikke svare på «skjedde dette under fredagsquizen?».
  logRateLimitHit(`live-ranking:${IP}:${QUIZ}`, {
    lag: 'lokal', limit: 30, windowMs: 60_000, quizId: QUIZ,
  })

  assert.match(loggtekst(), new RegExp(QUIZ))
})

test('valgfrie felt utelates helt når de ikke er oppgitt — ingen undefined-støy', () => {
  logRateLimitHit(`start-attempt:pre:${IP}`, { lag: 'burst', limit: 120, windowMs: 60_000 })

  const felt = linjer[0][1] as Record<string, unknown>
  assert.ok(!('innlogget' in felt))
  assert.ok(!('quizId' in felt))
})
