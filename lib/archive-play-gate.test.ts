// Kjøres med:  npm test
//
// Ren beslutningstest av decideArchivePlayGate og needsGeneratedOwnershipLookup.
// Rutekoblingen — at start-attempt og /api/arkiv/[id]/plassering faktisk
// kaller gaten med eierskapet, og at ingen attempt skrives ved avslag —
// felles av lib/start-attempt-archive-gate-route.test.ts og
// lib/arkiv-plassering-route.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  decideArchivePlayGate,
  needsGeneratedOwnershipLookup,
  ARCHIVE_PLAY_PREMIUM_ERROR,
  ARCHIVE_PLAY_UNKNOWN_ERROR,
  type GeneratedQuizOwnership,
} from '@/lib/archive-play-gate'
import type { Loaded } from '@/lib/fetch-result'

const PREMIUM: Loaded<boolean> = { ok: true, value: true }
const GRATIS: Loaded<boolean> = { ok: true, value: false }
const UKJENT: Loaded<boolean> = { ok: false }
const ALLE_PREMIUM: readonly Loaded<boolean>[] = [PREMIUM, GRATIS, UKJENT]

const KILDE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

/** Generert quiz (kilde NULL) med gitt eierskapssvar. */
function generert(owner: Loaded<boolean>): GeneratedQuizOwnership {
  return { sourceQuizId: null, owner }
}
/** Reprise av en fredagsquiz (kilde NOT NULL) med gitt eierskapssvar. */
function reprise(owner: Loaded<boolean>): GeneratedQuizOwnership {
  return { sourceQuizId: KILDE, owner }
}

const AVVIST_403 = { allowed: false, status: 403, error: ARCHIVE_PLAY_PREMIUM_ERROR }
const AVVIST_503 = { allowed: false, status: 503, error: ARCHIVE_PLAY_UNKNOWN_ERROR }

// ── Ikke-arkiv passerer ALLTID — også ved lesefeil ──────────────────────────
// Dette er selve regresjonsvernet for fredagsquizen: gaten skal ikke kunne
// påvirke den, uansett hva premium-oppslaget vet eller ikke vet — og uansett
// hva som sendes inn som eierskap.

test('fredagsquiz slipper gjennom uansett premium-tilstand — også «vet ikke»', () => {
  for (const quizType of ['weekly', 'bonus', 'test', null, undefined]) {
    for (const generated of [null, generert(UKJENT), generert(GRATIS), reprise(UKJENT)]) {
      assert.deepEqual(decideArchivePlayGate(quizType, UKJENT, generated), { allowed: true },
        `quiz_type=${quizType}: en lesefeil skal aldri stenge en ikke-arkivquiz`)
      assert.deepEqual(decideArchivePlayGate(quizType, GRATIS, generated), { allowed: true })
      assert.deepEqual(decideArchivePlayGate(quizType, PREMIUM, generated), { allowed: true })
    }
  }
})

// ── Arkiv uten eieroppslag (null): de tre opprinnelige utfallene ────────────

test('arkiv + premium → slipper inn', () => {
  assert.deepEqual(decideArchivePlayGate('archive', PREMIUM, null), { allowed: true })
})

test('arkiv + gratisbruker → 403 med oppsalgs-ordlyden fra POST /api/arkiv', () => {
  assert.deepEqual(decideArchivePlayGate('archive', GRATIS, null), AVVIST_403)
})

test('arkiv + «vet ikke» → 503, aldri 403 — en lesefeil er ikke en dom', () => {
  assert.deepEqual(decideArchivePlayGate('archive', UKJENT, null), AVVIST_503)
})

// ── Eieren av en GENERERT quiz slipper inn uten Premium ─────────────────────

test('generert + gratis + eier → slipper inn', () => {
  assert.deepEqual(decideArchivePlayGate('archive', GRATIS, generert(PREMIUM)), { allowed: true })
})

test('generert + gratis + IKKE eier → 403 (en annens genererte quiz er fortsatt Premium)', () => {
  assert.deepEqual(decideArchivePlayGate('archive', GRATIS, generert(GRATIS)), AVVIST_403)
})

test('generert + premium → inn uansett eierskap, også ukjent', () => {
  for (const owner of [PREMIUM, GRATIS, UKJENT]) {
    assert.deepEqual(decideArchivePlayGate('archive', PREMIUM, generert(owner)), { allowed: true })
  }
})

// ── Treverdig ELLER: én bekreftet sann side vinner, én ukjent side uten
//    bekreftet sann er 503 ───────────────────────────────────────────────────

test('premium ukjent + eier bekreftet → slipper inn (sann ELLER ukjent = sann)', () => {
  assert.deepEqual(decideArchivePlayGate('archive', UKJENT, generert(PREMIUM)), { allowed: true })
})

test('gratis + eierskap ukjent → 503, ikke 403 — et usant avslag til en eier er en dom', () => {
  assert.deepEqual(decideArchivePlayGate('archive', GRATIS, generert(UKJENT)), AVVIST_503)
})

test('premium ukjent + ikke eier → 503', () => {
  assert.deepEqual(decideArchivePlayGate('archive', UKJENT, generert(GRATIS)), AVVIST_503)
})

test('begge ukjent → 503', () => {
  assert.deepEqual(decideArchivePlayGate('archive', UKJENT, generert(UKJENT)), AVVIST_503)
})

// ── Kilde NOT NULL: eierskap teller ikke — porten for ekte arkivquizer er
//    ikke svekket ─────────────────────────────────────────────────────────────

test('reprise (kilde NOT NULL) + gratis + «eier» → 403 — ingen ledger-rad kan åpne en fredagsreprise', () => {
  assert.deepEqual(decideArchivePlayGate('archive', GRATIS, reprise(PREMIUM)), AVVIST_403)
})

test('reprise + gratis + eierskap ukjent → 403, ikke 503 — eierskapet er irrelevant, så ukjent eierskap er ikke «vet ikke»', () => {
  assert.deepEqual(decideArchivePlayGate('archive', GRATIS, reprise(UKJENT)), AVVIST_403)
})

test('reprise + premium ukjent → 503 uansett eierskap', () => {
  for (const owner of [PREMIUM, GRATIS, UKJENT]) {
    assert.deepEqual(decideArchivePlayGate('archive', UKJENT, reprise(owner)), AVVIST_503)
  }
})

// ── needsGeneratedOwnershipLookup: rutens «må jeg spørre ledgeren?» ─────────

test('oppslag trengs KUN for arkiv + ubekreftet premium + kilde NULL', () => {
  assert.equal(needsGeneratedOwnershipLookup('archive', GRATIS, null), true)
  assert.equal(needsGeneratedOwnershipLookup('archive', UKJENT, null), true)
  assert.equal(needsGeneratedOwnershipLookup('archive', GRATIS, undefined), true,
    'manglende kolonne i select-lista skal ikke stille skru av eier-grenen')
})

test('bekreftet premium → ingen oppslag (premium vinner uansett)', () => {
  assert.equal(needsGeneratedOwnershipLookup('archive', PREMIUM, null), false)
})

test('kilde NOT NULL → ingen oppslag (en reprise kan ikke bli eid)', () => {
  assert.equal(needsGeneratedOwnershipLookup('archive', GRATIS, KILDE), false)
  assert.equal(needsGeneratedOwnershipLookup('archive', UKJENT, KILDE), false)
})

test('ikke-arkiv → ALDRI oppslag, uansett premium og kilde — fredagsstien rører ikke quiz_generations', () => {
  for (const quizType of ['weekly', 'bonus', 'test', null, undefined]) {
    for (const p of ALLE_PREMIUM) {
      assert.equal(needsGeneratedOwnershipLookup(quizType, p, null), false, `quiz_type=${quizType}`)
    }
  }
})

// ── Konsistens: hopper ruten over oppslaget der det TRENGS, faller gaten til
//    dagens 403/503 — aldri til inn ──────────────────────────────────────────

test('null der oppslag trengtes gir premium-alene-svaret, aldri inn', () => {
  assert.deepEqual(decideArchivePlayGate('archive', GRATIS, null), AVVIST_403)
  assert.deepEqual(decideArchivePlayGate('archive', UKJENT, null), AVVIST_503)
})
