// Kjøres med:  npm test
//
// Ren beslutningstest av decideArchivePlayGate. Rutekoblingen — at
// start-attempt faktisk kaller gaten, og at ingen attempt skrives ved avslag
// — felles av lib/start-attempt-archive-gate-route.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  decideArchivePlayGate,
  ARCHIVE_PLAY_PREMIUM_ERROR,
  ARCHIVE_PLAY_UNKNOWN_ERROR,
} from '@/lib/archive-play-gate'

// ── Ikke-arkiv passerer ALLTID — også ved lesefeil ──────────────────────────
// Dette er selve regresjonsvernet for fredagsquizen: gaten skal ikke kunne
// påvirke den, uansett hva premium-oppslaget vet eller ikke vet.

test('fredagsquiz slipper gjennom uansett premium-tilstand — også «vet ikke»', () => {
  for (const quizType of ['weekly', 'bonus', 'test', null, undefined]) {
    assert.deepEqual(decideArchivePlayGate(quizType, { ok: false }), { allowed: true },
      `quiz_type=${quizType}: en lesefeil skal aldri stenge en ikke-arkivquiz`)
    assert.deepEqual(decideArchivePlayGate(quizType, { ok: true, value: false }), { allowed: true })
    assert.deepEqual(decideArchivePlayGate(quizType, { ok: true, value: true }), { allowed: true })
  }
})

// ── Arkiv: tre utfall, aldri en dom på «vet ikke» ───────────────────────────

test('arkiv + premium → slipper inn', () => {
  assert.deepEqual(decideArchivePlayGate('archive', { ok: true, value: true }), { allowed: true })
})

test('arkiv + gratisbruker → 403 med oppsalgs-ordlyden fra POST /api/arkiv', () => {
  assert.deepEqual(decideArchivePlayGate('archive', { ok: true, value: false }), {
    allowed: false,
    status: 403,
    error: ARCHIVE_PLAY_PREMIUM_ERROR,
  })
})

test('arkiv + «vet ikke» → 503, aldri 403 — en lesefeil er ikke en dom', () => {
  assert.deepEqual(decideArchivePlayGate('archive', { ok: false }), {
    allowed: false,
    status: 503,
    error: ARCHIVE_PLAY_UNKNOWN_ERROR,
  })
})
