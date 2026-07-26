// Kjøres med:  npm test
//
// Vokter ÉN regel: historikken står som den var. En endring i
// global_league_opt_out skal kun gjelde fremover — den skal aldri endre
// hvordan en quiz som allerede er spilt og gjort opp vises.
//
// Feilklassen testene finnes for: «Siste quiz»-fanen leste tidligere
// organization_members LIVE og gjenbrukte dagens status på en historisk quiz.
// En bruker som meldte seg ut ETTER at en quiz var spilt, forsvant da med
// tilbakevirkende kraft fra en quiz hen lovlig deltok i — mens de samme
// radene lå trygt i season_scores og fortsatt talte i måned/kvartal/år/
// all-time. De to fanene viste altså ulik historikk for samme quiz.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveBlockedFromScores,
  deriveBlockedFromLiveStatus,
  type OrgMembership,
} from '@/lib/global-league-visibility'

// ── Kjernen: konsistens mellom «Siste quiz» og periodevisningene ─────────────

test('KONSISTENS: bruker som meldte seg ut ETTER quizen beholder plassen sin', () => {
  // Fasit fra da quizen ble gjort opp: alle tre var med globalt.
  const attemptUserIds = ['u1', 'u2', 'u3']
  const scoredUserIds  = ['u1', 'u2', 'u3']

  // u2 har SIDEN meldt seg ut. Det påvirker ikke season_scores-radene, og
  // skal derfor heller ikke påvirke «Siste quiz».
  const blocked = deriveBlockedFromScores(attemptUserIds, scoredUserIds)

  assert.equal(blocked.size, 0, 'ingen skal skjules — alle hadde en global-rad')
  assert.ok(!blocked.has('u2'))

  // Det er nøyaktig det periodevisningene ville vist: season_scores-raden for
  // u2 finnes, så u2 teller i måned/kvartal/år/all-time.
  assert.ok(scoredUserIds.includes('u2'))
})

test('bruker som VAR blokkert da quizen ble gjort opp forblir skjult', () => {
  // u2 var utmeldt/org-blokkert på skrivetidspunktet → fikk aldri global-rad.
  const blocked = deriveBlockedFromScores(['u1', 'u2', 'u3'], ['u1', 'u3'])

  assert.deepEqual([...blocked], ['u2'])

  // Og det er igjen konsistent: uten season_scores-rad teller u2 heller ikke
  // i periodevisningene. Samme historikk begge steder.
})

test('en senere INNMELDING gir ikke poeng tilbakevirkende', () => {
  // Speilbildet av den første testen. u2 var blokkert da quizen ble gjort opp
  // og har siden meldt seg inn igjen — men den quizen er fortsatt uten rad.
  const blocked = deriveBlockedFromScores(['u1', 'u2'], ['u1'])
  assert.ok(blocked.has('u2'), 'historikken skal ikke endres av dagens status')
})

// ── Grensetilfeller ──────────────────────────────────────────────────────────

test('alle blokkert: ingen fikk global-rad', () => {
  const blocked = deriveBlockedFromScores(['u1', 'u2'], [])
  assert.deepEqual([...blocked].sort(), ['u1', 'u2'])
})

test('ingen forsøk gir tomt sett, ikke krasj', () => {
  assert.equal(deriveBlockedFromScores([], ['u1']).size, 0)
})

test('season_scores-rader for brukere uten forsøk påvirker ingenting', () => {
  // Skal ikke kunne skje, men fraværet av en attempt-rad må ikke gi utslag.
  const blocked = deriveBlockedFromScores(['u1'], ['u1', 'ukjent'])
  assert.equal(blocked.size, 0)
})

// ── Live-stien: brukes kun mens quizen ikke er gjort opp ──────────────────────

test('live-status: egen opt-out blokkerer', () => {
  const mems: OrgMembership[] = [
    { user_id: 'u1', organization_id: 'o1', global_league_opt_out: true },
    { user_id: 'u2', organization_id: 'o1', global_league_opt_out: false },
    { user_id: 'u3', organization_id: 'o1', global_league_opt_out: null },
  ]
  const blocked = deriveBlockedFromLiveStatus(mems, new Set())

  assert.deepEqual([...blocked], ['u1'])
  // null (aldri satt) skal IKKE telle som utmeldt.
  assert.ok(!blocked.has('u3'))
})

test('live-status: org med allow_global_league=false blokkerer alle medlemmer', () => {
  const mems: OrgMembership[] = [
    { user_id: 'u1', organization_id: 'lukket', global_league_opt_out: false },
    { user_id: 'u2', organization_id: 'apen',   global_league_opt_out: false },
  ]
  const blocked = deriveBlockedFromLiveStatus(mems, new Set(['lukket']))

  assert.deepEqual([...blocked], ['u1'])
})

test('live-status: bruker i to orger blokkeres hvis ÉN av dem er lukket', () => {
  const mems: OrgMembership[] = [
    { user_id: 'u1', organization_id: 'apen',   global_league_opt_out: false },
    { user_id: 'u1', organization_id: 'lukket', global_league_opt_out: false },
  ]
  const blocked = deriveBlockedFromLiveStatus(mems, new Set(['lukket']))
  assert.deepEqual([...blocked], ['u1'])
})

test('live-status uten medlemskap blokkerer ingen', () => {
  assert.equal(deriveBlockedFromLiveStatus([], new Set()).size, 0)
})

// ── De to stiene er ikke utbyttbare — det er hele poenget ────────────────────

test('MUTASJONSBEVIS: live-status og historisk fasit gir ULIKT svar etter en utmelding', () => {
  // Samme bruker, samme quiz. Quizen ble gjort opp mens u1 var med.
  const attemptUserIds = ['u1']
  const scoredUserIds  = ['u1']

  // u1 melder seg ut i dag.
  const liveMems: OrgMembership[] = [
    { user_id: 'u1', organization_id: 'o1', global_league_opt_out: true },
  ]

  const historisk = deriveBlockedFromScores(attemptUserIds, scoredUserIds)
  const live      = deriveBlockedFromLiveStatus(liveMems, new Set())

  // Den gamle koden brukte `live` på en historisk quiz og skjulte u1.
  assert.ok(live.has('u1'), 'live-status ville skjult u1')
  // Den nye bruker `historisk` og beholder u1 — som periodevisningene.
  assert.ok(!historisk.has('u1'), 'historisk fasit beholder u1')

  // Hvis noen senere bytter tilbake til live-filtrering på en gjort-opp quiz,
  // faller denne testen.
  assert.notDeepEqual([...historisk], [...live])
})
