// Kjøres med:  npm test
//
// Vokter nøkkel-avledningen for live-rutene (re-nøkling 22. august 2026).
// Ren logikk (HMAC-verifiseringen er lokal, ingen I/O) — rutebeviset ligger i
// lib/live-ranking-rekey-route.test.ts.
//
// MUTASJONSBEVIS
//   • Skriv om liveRateLimitKey til å ignorere tokenet (`${route}:${ip}:…`,
//     den gamle formen), og «to ulike forsøk bak SAMME IP …» ryker.
//   • Dropp verifiseringen og stol på attemptId alene, og «et påstått
//     attemptId uten gyldig token …» ryker — en angriper kunne da rotert
//     id-er for uendelig kvote.
//   • Endre grensen, og «grensen er UENDRET …» ryker — denne commiten skal
//     kun endre hvem som telles sammen, ikke hvor mye.
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Må settes FØR attempt-token brukes: signingKey() leser env ved hvert kall.
process.env.QUIZ_TOKEN_SECRET = 'test-hemmelighet-for-attempt-token'

const { liveRateLimitKey, LIVE_RANKING_RATE_LIMIT } = await import('@/lib/live-rate-limit')
const { createAttemptToken } = await import('@/lib/attempt-token')
const { keyPrefixOf } = await import('@/lib/rate-limit-protocol')
const { rateLimit } = await import('@/lib/rate-limit')

const IP = '203.0.113.7'
const QUIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ATTEMPT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ATTEMPT_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function token(attemptId: string, quizId: string = QUIZ): string {
  const t = createAttemptToken(attemptId, quizId)
  assert.ok(t, 'testoppsettet skal kunne lage token (QUIZ_TOKEN_SECRET er satt)')
  return t
}

// ── Kjernen: én IP er ikke én person — heller ikke her ──────────────────────

test('to ulike forsøk bak SAMME IP får ULIKE nøkler — Elkjøp-scenarioet', () => {
  const a = liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: ATTEMPT_A, token: token(ATTEMPT_A) })
  const b = liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: ATTEMPT_B, token: token(ATTEMPT_B) })

  assert.notEqual(a, b, 'kolleger bak kontornettet skal ikke spise hverandres kvote')
  assert.equal(a, `live-ranking:attempt:${ATTEMPT_A}`)
  assert.equal(b, `live-ranking:attempt:${ATTEMPT_B}`)
})

test('et GJESTE-forsøk med gyldig token får egen bøtte — gjester har også token', () => {
  // Attempt-tokenet vet ingenting om brukere: start-attempt utsteder det for
  // gjester og innloggede likt. user-id-nøkling (spillestiens mønster) ville
  // latt alle gjester bak ett nett dele anon-bøtta; attempt-nøkling gjør ikke det.
  const key = liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: ATTEMPT_A, token: token(ATTEMPT_A) })
  assert.equal(key, `live-ranking:attempt:${ATTEMPT_A}`)
  assert.ok(!key.includes(IP), 'med gyldig token skal IP ikke være del av nøkkelen')
})

// ── Fallback: token-løse kall skal fungere, i den strenge bøtta ─────────────

test('token-løst kall faller til anon:<ip> — gammel fane under deploy spiller videre', () => {
  assert.equal(
    liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: null, token: null }),
    `live-ranking:anon:${IP}`,
  )
  // attemptId uten token er også uverifisert → anon.
  assert.equal(
    liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: ATTEMPT_A, token: null }),
    `live-ranking:anon:${IP}`,
  )
})

test('anon-nøkkelen slipper faktisk gjennom telleren — fallback er spillbar', () => {
  const key = liveRateLimitKey('live-ranking', { ip: '198.51.100.99', quizId: QUIZ, attemptId: null, token: null })
  const rl = rateLimit(key, LIVE_RANKING_RATE_LIMIT.limit, LIVE_RANKING_RATE_LIMIT.windowMs)
  assert.equal(rl.success, true, 'et token-løst kall skal ikke avvises')
})

test('et påstått attemptId uten gyldig token havner i anon-bøtta', () => {
  // Forfalsket token → anon.
  assert.equal(
    liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: ATTEMPT_A, token: 'ugyldig.token' }),
    `live-ranking:anon:${IP}`,
  )
  // Gyldig token for et ANNET forsøk → anon (kan ikke flyttes).
  assert.equal(
    liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: ATTEMPT_A, token: token(ATTEMPT_B) }),
    `live-ranking:anon:${IP}`,
  )
  // Gyldig token for en ANNEN quiz → anon (kan ikke flyttes).
  const otherQuiz = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  assert.equal(
    liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: ATTEMPT_A, token: token(ATTEMPT_A, otherQuiz) }),
    `live-ranking:anon:${IP}`,
  )
})

// ── Personvern: hva som slipper ut via logRateLimitHit ──────────────────────

test('prefikset overlever keyPrefixOf — verken IP eller attempt-id lekker', () => {
  // logRateLimitHit (lib/rate-limit-log.ts) skreller alt etter første kolon.
  // Det nye nøkkelformatet <rute>:attempt:<id> må gi samme prefiks som det
  // gamle <rute>:<ip>:<quizId>, ellers brekker skrellingen (krav 5).
  for (const key of [
    liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: ATTEMPT_A, token: token(ATTEMPT_A) }),
    liveRateLimitKey('live-ranking', { ip: IP, quizId: QUIZ, attemptId: null, token: null }),
  ]) {
    const prefix = keyPrefixOf(key)
    assert.equal(prefix, 'live-ranking')
    assert.ok(!prefix.includes(IP))
    assert.ok(!prefix.includes(ATTEMPT_A))
  }
})

// ── Grensen er UENDRET — commiten endrer hvem som telles, ikke hvor mye ─────

test('grensen er UENDRET: 30 per 60 sekunder', () => {
  assert.equal(LIVE_RANKING_RATE_LIMIT.limit, 30)
  assert.equal(LIVE_RANKING_RATE_LIMIT.windowMs, 60_000)
})
