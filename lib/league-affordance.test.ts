// Kjøres med:  npm test
//
// OPPFØRSELSTEST for lib/league-affordance.ts. Den strukturelle halvdelen —
// at app/leaderboard/[id]/page.tsx faktisk SPØR denne funksjonen i stedet for
// å lese en boolean — ligger i lib/league-affordance-wiring.test.ts.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • `if (!leagues.ok) return { showFriendsTab: false, showLeagueCta: false }`
//     → `... showLeagueCta: !authLoading }` (altså «feil» tolket som «har ikke
//     ligaer», som er nøyaktig buggen fra før 31. august 2026) → testen
//     «uavklart ligastatus tenner ikke oppsalget» ryker.
//   • Samme linje → `showFriendsTab: true` → «uavklart ligastatus viser ikke
//     fanen» ryker.
//   • Fjernes `if (!leagues.ok)`-grenen helt, slik at koden faller ned i
//     `leagues.value` på en `{ ok: false }` → begge de to ryker (value er
//     undefined → falsy → CTA tennes).
//   • `showFriendsTab: leagues.value` → `!leagues.value` → «bekreftet medlem
//     får fanen» ryker.
//   • `showLeagueCta: !leagues.value && !authLoading` → `!leagues.value` →
//     «CTA-en venter på authLoading» ryker.
//   • Fjernes `orgMode ||` → «org-modus skjuler begge» ryker.
//   • Fjernes `!loggedIn` → «utlogget ser ingen av delene» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLeagueAffordance } from './league-affordance'
import type { Loaded } from './fetch-result'

const UKJENT: Loaded<boolean> = { ok: false }
const HAR: Loaded<boolean> = { ok: true, value: true }
const HAR_IKKE: Loaded<boolean> = { ok: true, value: false }

const base = { loggedIn: true, orgMode: false, authLoading: false }

test('uavklart ligastatus tenner ikke oppsalget («vet ikke» er ikke «har ikke»)', () => {
  assert.equal(decideLeagueAffordance({ ...base, leagues: UKJENT }).showLeagueCta, false)
})

test('uavklart ligastatus viser ikke «Blant venner»-fanen', () => {
  assert.equal(decideLeagueAffordance({ ...base, leagues: UKJENT }).showFriendsTab, false)
})

test('bekreftet medlem får fanen og ikke oppsalget', () => {
  const a = decideLeagueAffordance({ ...base, leagues: HAR })
  assert.deepEqual(a, { showFriendsTab: true, showLeagueCta: false })
})

test('bekreftet null ligaer får oppsalget og ikke fanen', () => {
  const a = decideLeagueAffordance({ ...base, leagues: HAR_IKKE })
  assert.deepEqual(a, { showFriendsTab: false, showLeagueCta: true })
})

test('CTA-en venter på at authLoading er ferdig — fanen gjør det ikke', () => {
  const laster = { ...base, authLoading: true }
  assert.equal(decideLeagueAffordance({ ...laster, leagues: HAR_IKKE }).showLeagueCta, false)
  assert.equal(decideLeagueAffordance({ ...laster, leagues: HAR }).showFriendsTab, true)
})

test('org-modus skjuler begge, uansett ligastatus', () => {
  for (const leagues of [UKJENT, HAR, HAR_IKKE]) {
    assert.deepEqual(
      decideLeagueAffordance({ ...base, orgMode: true, leagues }),
      { showFriendsTab: false, showLeagueCta: false },
      `org-modus lekket noe for ${JSON.stringify(leagues)}`,
    )
  }
})

test('utlogget ser ingen av delene, uansett ligastatus', () => {
  for (const leagues of [UKJENT, HAR, HAR_IKKE]) {
    assert.deepEqual(
      decideLeagueAffordance({ ...base, loggedIn: false, leagues }),
      { showFriendsTab: false, showLeagueCta: false },
      `utlogget fikk noe for ${JSON.stringify(leagues)}`,
    )
  }
})

test('fanen og CTA-en er aldri sanne samtidig, og aldri begge falske uten grunn', () => {
  // Den ene invarianten hele saken handler om: de TO flatene skal ikke kunne
  // motsi hverandre. Én kombinasjon skal være umulig (begge sanne), og «begge
  // falske» skal kun oppstå av en KJENT grunn — org, utlogget eller uavklart.
  for (const leagues of [UKJENT, HAR, HAR_IKKE]) {
    for (const loggedIn of [true, false]) {
      for (const orgMode of [true, false]) {
        for (const authLoading of [true, false]) {
          const a = decideLeagueAffordance({ leagues, loggedIn, orgMode, authLoading })
          assert.ok(!(a.showFriendsTab && a.showLeagueCta), 'begge flatene tent samtidig')
          if (!a.showFriendsTab && !a.showLeagueCta) {
            assert.ok(
              orgMode || !loggedIn || !leagues.ok || authLoading,
              'begge flatene skjult uten kjent grunn',
            )
          }
        }
      }
    }
  }
})
