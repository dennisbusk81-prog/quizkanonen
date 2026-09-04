// Kjøres med:  npm test
//
// OPPFØRSELSTEST av decideSidePanelPlacement (N-8). Wiringen — at
// app/quiz/[id]/page.tsx faktisk spør predikatet og TEGNER svaret — er dekket
// av lib/side-panel-placement-wiring.test.ts. De to hører sammen: denne alene
// ville godtatt at kallstedet sluttet å kalle predikatet, og wiring-filen
// alene ville godtatt at predikatet svarte feil.
//
// ── BEGGE RETNINGER ─────────────────────────────────────────────────────────
// Ikke bare «eksakt når serveren ga det». Like viktig: bånd når serveren IKKE
// ga det — det er gratisvisningen, og en fiks som lot gratisbrukeren stå uten
// noe som helst ville vært en ny bug i motsatt retning.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Snus rekkefølgen (bånd sjekkes først) → «eksakt vinner over bånd» ryker.
//   • Fjernes totalPlayers-terskelen → «én spiller i feltet gir ikke eksakt» ryker.
//   • Returneres liveRanking.userRank som `low` i stedet → «eksakt bærer
//     userRank, ikke low» ryker.
//   • Gjøres bånd-grenen ubetinget (null-sjekken fjernes) → «ingenting uten
//     bånd» ryker (den ville returnert { band, null, null }).
//   • Gjøres eksakt-grenen ubetinget (`liveRanking &&` fjernes) → alle
//     bånd-testene kaster på `null.totalPlayers` — også en form for rødt.
//   • Fjernes `typeof userRank === 'number'`-leddet → «objekt med userRank =
//     null er IKKE eksakt» ryker (predikatet ville returnert { exact, null }).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideSidePanelPlacement } from './side-panel-placement'

const eksakt = (userRank: number, totalPlayers = 60) => ({ userRank, totalPlayers })

// ── Eksakt: serveren ga et tall ─────────────────────────────────────────────

test('serveren ga eksakt plassering → eksakt, og tallet er userRank', () => {
  assert.deepEqual(
    decideSidePanelPlacement({ liveRanking: eksakt(59), low: 57, high: 60 }),
    { kind: 'exact', rank: 59 },
  )
})

test('eksakt vinner over bånd når begge finnes — bånd er gratisvisningen', () => {
  // Nøyaktig 4. september-tilstanden: premium-stien setter BÅDE low/high og
  // interLiveRanking. Panelet tegnet båndet. Nå skal det tegne tallet.
  const r = decideSidePanelPlacement({ liveRanking: eksakt(60), low: 58, high: 60 })
  assert.equal(r.kind, 'exact')
})

test('eksakt bærer userRank, ikke low — de er ulike tall', () => {
  // low = rank − 2 (lib/ranking-snapshot.ts). En implementasjon som tok feil
  // felt ville vist «#57» til en som ligger på 59.
  const r = decideSidePanelPlacement({ liveRanking: eksakt(59), low: 57, high: 61 })
  assert.equal(r.kind, 'exact')
  if (r.kind === 'exact') assert.equal(r.rank, 59)
})

test('én spiller i feltet gir ikke eksakt — speiler QuizInterlude sin terskel', () => {
  // «#1 av 1» er sant og meningsløst. Mellomskjermen krever totalPlayers >= 2
  // for sin eksakte blokk; panelet skal ikke si mer enn den.
  const r = decideSidePanelPlacement({ liveRanking: eksakt(1, 1), low: null, high: null })
  assert.equal(r.kind, 'none')
})

test('nøyaktig to spillere er nok for eksakt', () => {
  const r = decideSidePanelPlacement({ liveRanking: eksakt(2, 2), low: 1, high: 2 })
  assert.deepEqual(r, { kind: 'exact', rank: 2 })
})

test('objekt med userRank = null er IKKE eksakt — objektet er truthy, tallet mangler', () => {
  // Kan ikke oppstå fra dagens setter (goToNext skriver objektet kun når
  // userRank !== null), men den vakten bor hos skriveren. Predikatet skal ikke
  // stole på det: et objekt beviser ikke at feltet er et tall, og «#null» er
  // verre enn båndet. Ingen eksakt → bånd hvis bånd finnes, ellers ingenting.
  const nullRank = { userRank: null, totalPlayers: 60 }
  assert.deepEqual(
    decideSidePanelPlacement({ liveRanking: nullRank, low: 57, high: 60 }),
    { kind: 'band', low: 57, high: 60 },
  )
  assert.deepEqual(
    decideSidePanelPlacement({ liveRanking: nullRank, low: null, high: null }),
    { kind: 'none' },
  )
})

// ── Bånd: serveren ga IKKE et tall ──────────────────────────────────────────

test('ingen eksakt fra serveren, men bånd → bånd med de samme tallene', () => {
  assert.deepEqual(
    decideSidePanelPlacement({ liveRanking: null, low: 56, high: 58 }),
    { kind: 'band', low: 56, high: 58 },
  )
})

test('undefined liveRanking behandles som null — begge betyr «serveren ga ingen»', () => {
  assert.deepEqual(
    decideSidePanelPlacement({ liveRanking: undefined, low: 56, high: 58 }),
    { kind: 'band', low: 56, high: 58 },
  )
})

test('liveRanking under terskelen faller til bånd hvis bånd finnes', () => {
  // Kan ikke oppstå fra premium-stien i dag (low/high settes kun ved total>1),
  // men predikatet skal være totalt: ingen kombinasjon skal gi et halvt svar.
  const r = decideSidePanelPlacement({ liveRanking: eksakt(1, 1), low: 1, high: 1 })
  assert.deepEqual(r, { kind: 'band', low: 1, high: 1 })
})

// ── Ingenting ───────────────────────────────────────────────────────────────

test('verken eksakt eller bånd → ingenting (panelet viser ventetekst)', () => {
  assert.deepEqual(
    decideSidePanelPlacement({ liveRanking: null, low: null, high: null }),
    { kind: 'none' },
  )
})

test('halvt bånd (kun low ELLER high) er ikke et bånd', () => {
  assert.equal(decideSidePanelPlacement({ liveRanking: null, low: 5, high: null }).kind, 'none')
  assert.equal(decideSidePanelPlacement({ liveRanking: null, low: null, high: 5 }).kind, 'none')
})
