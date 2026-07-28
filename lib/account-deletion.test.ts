// Kjøres med:  npm test
//
// FUNN 3.2 — leagues.owner_id er ON DELETE CASCADE, så en liga-eier som sletter
// kontoen sin river hele ligaen for alle de andre medlemmene.
//
// MUTASJONSBEVIS: får pickSuccessor til å returnere null uansett (altså den
// gamle oppførselen der ligaen alltid forsvinner), feiler «ligaen overlever»
// og «ansiennitet avgjør». Snus sorteringen til nyeste først, feiler
// «ansiennitet avgjør».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickSuccessor, planLeagueOwnership, type LeagueMemberRef } from './account-deletion'

const EIER = 'eier-1111'
const GAMMEL = 'aaaa-lengst'
const NY = 'bbbb-nyest'

const medlem = (user_id: string, joined_at: string | null): LeagueMemberRef => ({ user_id, joined_at })

test('ligaen overlever: eierskap overføres når det finnes andre medlemmer', () => {
  const plan = planLeagueOwnership('liga-1', [
    medlem(EIER, '2026-01-01T00:00:00.000Z'),
    medlem(NY, '2026-05-01T00:00:00.000Z'),
  ], EIER)

  assert.equal(plan.action, 'transfer')
  assert.equal(plan.action === 'transfer' && plan.newOwnerId, NY)
})

test('ansiennitet avgjør — lengst medlem arver, ikke nyeste', () => {
  const plan = planLeagueOwnership('liga-1', [
    medlem(EIER, '2026-01-01T00:00:00.000Z'),
    medlem(NY, '2026-06-01T00:00:00.000Z'),
    medlem(GAMMEL, '2026-02-01T00:00:00.000Z'),
  ], EIER)

  assert.equal(plan.action === 'transfer' && plan.newOwnerId, GAMMEL)
})

test('eneste medlem: ligaen slettes — ingen andre rammes', () => {
  const plan = planLeagueOwnership('liga-1', [medlem(EIER, '2026-01-01T00:00:00.000Z')], EIER)
  assert.equal(plan.action, 'delete')
})

test('tom medlemsliste behandles som eneste medlem', () => {
  assert.equal(planLeagueOwnership('liga-1', [], EIER).action, 'delete')
})

test('eieren kan aldri arve sin egen liga', () => {
  // Selv om eieren har lavest joined_at skal han aldri velges.
  const successor = pickSuccessor([
    medlem(EIER, '2020-01-01T00:00:00.000Z'),
    medlem(NY, '2026-06-01T00:00:00.000Z'),
  ], EIER)
  assert.equal(successor, NY)
})

test('joined_at = null sorteres SIST — kan ikke slå en dokumentert ansiennitet', () => {
  const successor = pickSuccessor([
    medlem(EIER, '2026-01-01T00:00:00.000Z'),
    medlem('ukjent-tid', null),
    medlem(GAMMEL, '2026-09-01T00:00:00.000Z'),
  ], EIER)
  assert.equal(successor, GAMMEL, 'en rad med tidspunkt skal vinne over en uten')
})

test('kun null-rader: fortsatt deterministisk, brytes på user_id', () => {
  const a = pickSuccessor([medlem(EIER, null), medlem('zzz', null), medlem('aaa', null)], EIER)
  const b = pickSuccessor([medlem(EIER, null), medlem('aaa', null), medlem('zzz', null)], EIER)
  assert.equal(a, 'aaa')
  assert.equal(a, b, 'rekkefølgen inn skal ikke endre hvem som arver')
})

test('likt joined_at brytes deterministisk på user_id', () => {
  const t = '2026-03-01T00:00:00.000Z'
  const a = pickSuccessor([medlem(EIER, t), medlem('bbb', t), medlem('aaa', t)], EIER)
  const b = pickSuccessor([medlem(EIER, t), medlem('aaa', t), medlem('bbb', t)], EIER)
  assert.equal(a, 'aaa')
  assert.equal(a, b, 'to kjøringer på samme data skal gi samme eier')
})

test('input-arrayet muteres ikke', () => {
  const members = [medlem(EIER, '2026-01-01T00:00:00.000Z'), medlem(NY, '2026-02-01T00:00:00.000Z')]
  const kopi = members.map(m => m.user_id)
  pickSuccessor(members, EIER)
  assert.deepEqual(members.map(m => m.user_id), kopi)
})
