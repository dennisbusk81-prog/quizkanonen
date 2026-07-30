// Kjøres med:  npm test
//
// Vokter ÉN invariant: et feilsvar fra members-activity skal aldri bli til en
// tom medlemsliste. Commit 1297661 la inn en 500 i org-ruten, og 09591ae samme
// i liga-ruten, nettopp for å unngå stille degradering — men begge klientene
// gjorde `res.ok ? await res.json() : { members: [] }` og oversatte 500-en
// tilbake til «ingen aktivitet». Fiksen i ruten var dermed usynlig for admin.
//
// MUTASJONSBEVIS — endre linjen i lib/members-activity-fetch.ts, og navngitt
// test skal feile:
//   1. `if (!res.ok) return { ok: false }` → `{ ok: true, members: [] }`
//      → «500 blir ikke til en tom liste» + «403/404/502 …» feiler
//   2. Fjern try/catch (la den kaste)
//      → «nettverksfeil blir ikke til en tom liste» feiler
//   3. `json?.members ?? []` → `[]`
//      → «200 med medlemmer gir medlemmene» feiler
//   4. La 200 uten members-felt gi { ok: false }
//      → «200 uten members er reelt tomt, ikke en feil» feiler
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchMembersActivity } from '@/lib/members-activity-fetch'

type Member = { userId: string }

const respond = (ok: boolean, body: unknown) => () =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) })

test('500 blir ikke til en tom liste', async () => {
  const result = await fetchMembersActivity<Member>(
    respond(false, { error: 'Kunne ikke hente aktivitetsdata.' })
  )

  assert.equal(result.ok, false, 'en 500 er «vet ikke», ikke «ingen aktivitet»')
  assert.ok(!('members' in result), 'det skal ikke finnes en medlemsliste å rendre ved feil')
})

test('403/404/502 blir heller ikke til en tom liste', async () => {
  for (const body of [{ error: 'Kun admins kan se dette.' }, { error: 'Fant ikke' }, null]) {
    const result = await fetchMembersActivity<Member>(respond(false, body))
    assert.equal(result.ok, false)
  }
})

test('nettverksfeil blir ikke til en tom liste', async () => {
  const result = await fetchMembersActivity<Member>(() => Promise.reject(new Error('offline')))

  assert.equal(result.ok, false)
})

test('ugyldig JSON i et 200-svar blir ikke til en tom liste', async () => {
  const result = await fetchMembersActivity<Member>(() =>
    Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('ikke JSON')) })
  )

  assert.equal(result.ok, false, 'et svar vi ikke klarte å lese er «vet ikke»')
})

test('200 med medlemmer gir medlemmene', async () => {
  const result = await fetchMembersActivity<Member>(
    respond(true, { members: [{ userId: 'a1' }, { userId: 'b2' }] })
  )

  assert.equal(result.ok, true)
  assert.deepEqual(result.ok && result.members.map(m => m.userId), ['a1', 'b2'])
})

test('200 uten members er reelt tomt, ikke en feil', async () => {
  // En bedrift eller liga KAN ha null medlemmer. Det er en sannhet vi har lov
  // til å vise — i motsetning til et feilsvar.
  for (const body of [{ members: [] }, {}, null]) {
    const result = await fetchMembersActivity<Member>(respond(true, body))
    assert.equal(result.ok, true, 'et vellykket svar skal ikke bli en feilboks')
    assert.deepEqual(result.ok && result.members, [])
  }
})

test('«tomt» og «vet ikke» kan ikke forveksles av en kaller', async () => {
  // Regresjonsvakten for hele feilklassen: en kaller som kun ser på lengden av
  // en array kan ikke skille de to. Unionen tvinger fram sjekken.
  const empty = await fetchMembersActivity<Member>(respond(true, { members: [] }))
  const failed = await fetchMembersActivity<Member>(respond(false, {}))

  assert.notEqual(empty.ok, failed.ok, 'de to utfallene må være skillbare')
})
