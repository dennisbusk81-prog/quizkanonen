// Kjøres med:  npm test  (eller smalt: --test lib/leaderboard-visibility.test.ts)
//
// decideHiddenUntilClosed — den DELTE «skjult til quizen stenger»-beslutningen
// for klient (app/leaderboard/[id]/page.tsx) og server
// (app/api/leaderboard/[id]/route.ts). B1/B5 i NONNULL-sveipet 26. august 2026.
// At begge kallstedene faktisk bruker funksjonen, felles av
// lib/nonnull-quiz-date-sites.test.ts — her felles selve logikken.
//
// MUTASJONSBEVIS:
//   • Fjernes `closesAt === null`-grenen → «NULL låser aldri ute for alltid»
//     ryker (isQuizClosed(null) = åpen → skjult permanent, nøyaktig B5).
//   • Byttes til klientens gamle epoch-tolkning (NULL ∼ stengt 1970 → vis) på
//     EN av sidene → strukturtestene i nonnull-quiz-date-sites ryker, for
//     logikken bor kun her.
//   • Fjernes premium-unntaket → «egen rad løfter skjulingen» ryker.
//   • Fjernes flagg-sjekken → «uten flagg skjules ingenting» ryker.
//   • Snus isQuizClosed-grenen → «stengt quiz skjules ikke» ryker.
//
// FIXTUR-REGEL: ekte, ULIKE datoer — aldri epoch; en epoch-fixtur ville skjult
// nøyaktig new Date(null)-fella dette sveipet jakter på.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideHiddenUntilClosed } from './leaderboard-visibility'

const NOW = new Date('2026-08-26T12:00:00Z').getTime()
const CLOSES_FRAMTID = '2026-08-28T22:00:00Z'
const CLOSES_FORTID = '2026-08-23T20:30:00Z'

function inndata(overstyr: Partial<Parameters<typeof decideHiddenUntilClosed>[0]> = {}) {
  return {
    hideUntilClosed: true,
    closesAt: CLOSES_FRAMTID as string | null,
    premiumViewerHasOwnRow: false,
    now: NOW,
    ...overstyr,
  }
}

// ── Ekte datoer: uendret oppførsel fra før sveipet ──────────────────────────

test('flagget + åpen quiz (ekte framtidsdato) = skjult', () => {
  assert.equal(decideHiddenUntilClosed(inndata()), true)
})

test('flagget + stengt quiz (ekte fortidsdato) = ikke skjult', () => {
  assert.equal(decideHiddenUntilClosed(inndata({ closesAt: CLOSES_FORTID })), false)
})

test('uten flagg skjules ingenting, uansett dato', () => {
  assert.equal(decideHiddenUntilClosed(inndata({ hideUntilClosed: false })), false)
  assert.equal(decideHiddenUntilClosed(inndata({ hideUntilClosed: false, closesAt: null })), false)
})

test('Premium med egen rad løfter skjulingen på en åpen quiz', () => {
  assert.equal(decideHiddenUntilClosed(inndata({ premiumViewerHasOwnRow: true })), false)
})

// ── B5: NULL = stenger aldri → aldri skjult for alltid ──────────────────────

test('NULL closes_at låser aldri stillingen ute for alltid', () => {
  // «Til quizen stenger» kan aldri inntreffe når quizen aldri stenger — da er
  // permanent skjuling ikke et utfall flagget skal kunne gi (Dennis-beslutning
  // 26. august 2026: arkivkopier skal uansett ikke arve flagget).
  assert.equal(decideHiddenUntilClosed(inndata({ closesAt: null })), false)
})

test('NULL closes_at: utfallet avhenger ikke av premium-unntaket', () => {
  // Skjulingen er alt løftet av NULL-standpunktet — ikke av hvem som spør.
  assert.equal(
    decideHiddenUntilClosed(inndata({ closesAt: null, premiumViewerHasOwnRow: true })),
    false
  )
})

// ── B1-pariteten på logikknivå ──────────────────────────────────────────────

test('samme inndata gir samme svar — funksjonen er deterministisk over feltene', () => {
  // Klient og server bygger inndata fra samme quiz-rad (closes_at +
  // hide_leaderboard_until_closed). Kaller de samme funksjon med samme felt,
  // kan de ikke konkludere ulikt — med og uten datoer.
  for (const closesAt of [CLOSES_FRAMTID, CLOSES_FORTID, null]) {
    const klient = decideHiddenUntilClosed(inndata({ closesAt }))
    const server = decideHiddenUntilClosed(inndata({ closesAt }))
    assert.equal(klient, server)
  }
})
