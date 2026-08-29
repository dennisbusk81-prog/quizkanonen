// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// ENHETSTEST av lib/archive-placement.ts — spøkelsesplasseringen. Den EKTE
// computePlacement og den EKTE rankQuizAttempts kjøres; kun supabase-admin er
// mocket, og bare fordi lib/ranking-snapshot.ts importerer den på toppnivå
// (computePlacement selv rører den aldri). Samme mal som
// lib/compute-placement.test.ts.
//
// FIXTURE-REGELEN: hver feltrad har distinkte verdier i correct_answers OG
// total_time_ms, så et ledd som sammenligner feil felt ikke kan se riktig ut.
// Unntaket er org-testen, der to rader deler poeng med vilje for å isolere
// medlemsfilteret fra rangeringen.
//
// MUTASJONSBEVIS (alle kjørt 27. august 2026 og revertert):
//
// Tallet i parentes er hvor mange tester som ble røde, kjørt mot BEGGE
// testfilene for flaten (denne + lib/arkiv-plassering-route.test.ts, 41
// tester til sammen).
//
//   FELLE 1 — tom-felt-guarden:
//   • fjern `if (ranked.length === 0) return { kind: 'ingen', … }`   (4 røde)
//       → utfallet ble { kind: 'plassering', rank: 1, total: 1 } — nøyaktig
//         «nr. 1 av 1»-løgnen guarden finnes for.
//   • ÆRLIG UNNTAK: å FLYTTE guarden til etter computePlacement-kallet, som
//     `if (placement.total === 1)`, er IKKE felt av noen test — og skal ikke
//     påstås felt. Den varianten er semantisk EKVIVALENT så lenge
//     `playerInPool: false` står: da er `total = felt + 1`, så total === 1
//     inntreffer bare for et tomt felt, og et ekte felt med én deltaker gir
//     total 2. Paret er likevel låst, fordi den andre halvdelen ER felt:
//   • `playerInPool: false` → `true`                                 (7 røde)
//       → `total` kollapser til feltets størrelse og rank kan overstige den.
//     Guardens plassering FØR kallet står altså av lesbarhets- og
//     intensjonsgrunner (se filhodet), ikke fordi en test krever den.
//
//   FELLE 2 — egen original rad ut av feltet:
//   • fjern `.filter((r) => r.user_id !== input.self.userId)`        (4 røde)
//       → spilleren dyttes ned av sitt eget gamle resultat.
//   • bytt `selfWasInField` til hardkodet `false`                    (3 røde)
//
//   FELLE 3 — org- kontra globalt felt:
//   • `const memberSet = … : null` → `const memberSet = null`        (5 røde)
//       → org-kallet måler mot det globale feltet mens `scope` fortsatt sier
//         'org' — den stille varianten av feilen.
//   • bytt medlemsfilteret til `!memberSet.has(...)` (komplementet)  (5 røde)
//   • la blocked-settet gjelde OGSÅ i org-scope                      (1 rød)
//   • fjern blocked-filteret fra den globale grenen                  (2 røde)
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

// ranking-snapshot importerer supabase-admin på toppnivå; computePlacement er
// ren og rører den aldri. Mocken finnes kun for at importen ikke skal kreve
// env-variabler.
mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: {} },
})

const { decideArchivePlacement } = await import('./archive-placement')
type Field = Parameters<typeof decideArchivePlacement>[0]['field']

const MEG = 'user-meg'
const KILDE = 'quiz-47'

function rad(
  id: string,
  userId: string | null,
  correct: number,
  timeMs: number
): Field[number] {
  return {
    id,
    user_id: userId,
    player_name: `spiller-${id}`,
    correct_answers: correct,
    total_time_ms: timeMs,
    correct_streak: 0,
    submitted_at: '2026-08-14T20:30:00.000Z',
  }
}

function kall(over: Partial<Parameters<typeof decideArchivePlacement>[0]> = {}) {
  return decideArchivePlacement({
    sourceQuizId: KILDE,
    field: [],
    self: { userId: MEG, correctAnswers: 10, totalTimeMs: 60_000, isTeam: false },
    orgMemberIds: null,
    blockedUserIds: new Set<string>(),
    ...over,
  })
}

// ═══ FELLE 1 — computePlacement gir «nr. 1 av 1» for tomt felt ═════════════

test('FELLE 1: tomt felt gir «ingen plassering finnes», IKKE «nr. 1 av 1»', () => {
  assert.deepEqual(kall({ field: [] }), { kind: 'ingen', reason: 'tomt-felt' })
})

test('FELLE 1: ingen kildequiz → «ingen-kilde» (generert quiz, normaltilstand)', () => {
  assert.deepEqual(
    kall({ sourceQuizId: null, field: [rad('a', 'annen', 14, 50_000)] }),
    { kind: 'ingen', reason: 'ingen-kilde' }
  )
})

test('FELLE 1: felt der ALLE radene filtreres bort blir tomt-felt, ikke nr. 1 av 1', () => {
  // Eneste deltakeren er spilleren selv → feltet er tomt etter uttrekket.
  assert.deepEqual(
    kall({ field: [rad('min-gamle', MEG, 12, 70_000)] }),
    { kind: 'ingen', reason: 'tomt-felt' }
  )
})

test('FELLE 1: et EKTE felt med nøyaktig én deltaker skjules IKKE', () => {
  // Guarden skal felle det tomme feltet, ikke det lille. Her finnes det en
  // reell motstander, og spilleren var dårligere → 2. plass av 2.
  const res = kall({
    field: [rad('a', 'annen', 15, 40_000)],
    self: { userId: MEG, correctAnswers: 9, totalTimeMs: 90_000, isTeam: false },
  })
  assert.deepEqual(res, {
    kind: 'plassering',
    rank: 2,
    total: 2,
    fieldSize: 1,
    selfWasInField: false,
    previous: null,
    scope: 'global',
  })
})

test('lagforsøk måles ikke mot solo-feltet', () => {
  assert.deepEqual(
    kall({
      field: [rad('a', 'annen', 14, 50_000)],
      self: { userId: MEG, correctAnswers: 10, totalTimeMs: 60_000, isTeam: true },
    }),
    { kind: 'ingen', reason: 'lagforsok' }
  )
})

// ═══ FELLE 2 — spillerens egen originale rad må ut av feltet ═══════════════

test('FELLE 2: egen original rad trekkes ut FØR rangeringen', () => {
  // Feltet: min gamle rad (14 riktige) + to andre (12 og 9).
  // Med egen rad inne ville arkivscoren på 13 havnet på 2. plass av 4.
  // Uten den: 1. plass av 3 (to andre + meg selv).
  const res = kall({
    field: [
      rad('min-gamle', MEG, 14, 55_000),
      rad('b', 'bjorn', 12, 72_000),
      rad('c', 'carina', 9, 83_000),
    ],
    self: { userId: MEG, correctAnswers: 13, totalTimeMs: 60_000, isTeam: false },
  })
  assert.deepEqual(res, {
    kind: 'plassering',
    rank: 1,
    total: 3,
    fieldSize: 2,
    selfWasInField: true,
    previous: { rank: 1, correctAnswers: 14 },
    scope: 'global',
  })
})

test('FELLE 2: spilte hun IKKE originalen, er hun ny i feltet', () => {
  const res = kall({
    field: [rad('b', 'bjorn', 12, 72_000), rad('c', 'carina', 9, 83_000)],
    self: { userId: MEG, correctAnswers: 10, totalTimeMs: 60_000, isTeam: false },
  })
  assert.deepEqual(res, {
    kind: 'plassering',
    rank: 2,
    total: 3,
    fieldSize: 2,
    selfWasInField: false,
    previous: null,
    scope: 'global',
  })
})

test('FELLE 2: gjesterad kan ikke trekkes ut — dokumentert grense', () => {
  // Spilte hun originalen uinnlogget, har raden ingen user_id og blir
  // stående. Testen låser den kjente grensen så den ikke «fikses» stille.
  const res = kall({
    field: [rad('gjest', null, 14, 55_000)],
    self: { userId: MEG, correctAnswers: 13, totalTimeMs: 60_000, isTeam: false },
  })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.equal(res.fieldSize, 1)
  assert.equal(res.selfWasInField, false)
  assert.equal(res.rank, 2)
})

// ═══ FELLE 3 — org-medlemmer måles mot det interne feltet ══════════════════

const ELKJOP = ['user-anne', 'user-bjorn', MEG]

test('FELLE 3: org-medlem måles mot det INTERNE feltet, ikke det globale', () => {
  // Seks i det globale feltet, tre av dem kolleger (inkl. meg selv).
  // Internt: Anne (14) og Bjørn (11) står igjen etter at min gamle rad er ute.
  // Arkivscoren 12 → 2. plass av 3 internt. Globalt ville den vært 5. av 6.
  const field = [
    rad('x1', 'utenfor-1', 15, 40_000),
    rad('x2', 'utenfor-2', 14, 45_000),
    rad('a', 'user-anne', 14, 50_000),
    rad('x3', 'utenfor-3', 13, 47_000),
    rad('b', 'user-bjorn', 11, 66_000),
    rad('min-gamle', MEG, 8, 90_000),
  ]
  const self = { userId: MEG, correctAnswers: 12, totalTimeMs: 60_000, isTeam: false }

  assert.deepEqual(kall({ field, self, orgMemberIds: ELKJOP }), {
    kind: 'plassering',
    rank: 2,
    total: 3,
    fieldSize: 2,
    selfWasInField: true,
    previous: { rank: 3, correctAnswers: 8 },
    scope: 'org',
  })

  // Samme forsøk uten org-parameter → det globale feltet, andre tall.
  assert.deepEqual(kall({ field, self }), {
    kind: 'plassering',
    rank: 5,
    total: 6,
    fieldSize: 5,
    selfWasInField: true,
    previous: { rank: 6, correctAnswers: 8 },
    scope: 'global',
  })
})

test('FELLE 3: gjester faller ut av det interne feltet', () => {
  const res = kall({
    field: [rad('a', 'user-anne', 14, 50_000), rad('gjest', null, 15, 30_000)],
    orgMemberIds: ELKJOP,
    self: { userId: MEG, correctAnswers: 12, totalTimeMs: 60_000, isTeam: false },
  })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.equal(res.fieldSize, 1)
  assert.equal(res.rank, 2)
})

test('FELLE 3: org uten andre medlemsforsøk → tomt-felt, ikke nr. 1 av 1', () => {
  assert.deepEqual(
    kall({
      field: [rad('x1', 'utenfor-1', 15, 40_000)],
      orgMemberIds: ELKJOP,
    }),
    { kind: 'ingen', reason: 'tomt-felt' }
  )
})

// ═══ Blocked-settet: globalt ja, internt nei ═══════════════════════════════

test('blokkert spiller er ute av det GLOBALE feltet (paritet med leaderboardet)', () => {
  const res = kall({
    field: [rad('a', 'user-anne', 14, 50_000), rad('b', 'user-bjorn', 11, 66_000)],
    blockedUserIds: new Set(['user-anne']),
    self: { userId: MEG, correctAnswers: 12, totalTimeMs: 60_000, isTeam: false },
  })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.equal(res.fieldSize, 1)
  assert.equal(res.rank, 1)
})

test('blokkert kollega teller MED i det interne feltet', () => {
  // «Det er nettopp dit de blokkerte hører hjemme» — samme skille som
  // app/api/leaderboard/[id]/route.ts gjør for ?org=.
  const res = kall({
    field: [rad('a', 'user-anne', 14, 50_000), rad('b', 'user-bjorn', 11, 66_000)],
    blockedUserIds: new Set(['user-anne']),
    orgMemberIds: ELKJOP,
    self: { userId: MEG, correctAnswers: 12, totalTimeMs: 60_000, isTeam: false },
  })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.equal(res.fieldSize, 2)
  assert.equal(res.rank, 2)
})

// ═══ Ingen navn forlater funksjonen ════════════════════════════════════════

test('utfallet bærer KUN tall — ingen navn, ingen naboer over/under', () => {
  const res = kall({ field: [rad('a', 'annen', 15, 40_000)] })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.deepEqual(
    Object.keys(res).sort(),
    ['fieldSize', 'kind', 'previous', 'rank', 'scope', 'selfWasInField', 'total']
  )
})

test('previous bærer også KUN tall — ingen navn lekker via det gamle resultatet', () => {
  // `previous` utledes av en RAD, ikke av et tall, og raden har `player_name`.
  // Nøkkellisten over ville ikke fanget at hele raden ble sendt videre — den
  // ser bare at feltet «previous» finnes. Derfor felles innholdet separat.
  const res = kall({
    field: [rad('a', 'annen', 15, 40_000), rad('min-gamle', MEG, 12, 70_000)],
    self: { userId: MEG, correctAnswers: 11, totalTimeMs: 80_000, isTeam: false },
  })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.deepEqual(Object.keys(res.previous ?? {}).sort(), ['correctAnswers', 'rank'])
})

// ═══ «Står i dag» — eget gammelt resultat (previous) ═══════════════════════
//
// TO ULIKE SPØRSMÅL, TO ULIKE POPULASJONER. Spøkelsesplasseringen rangerer
// feltet UTEN henne (hun skal ikke konkurrere mot seg selv); `previous`
// rangerer feltet MED henne (hun var beviselig med den gangen). Testene under
// låser at de to ikke smelter sammen.
//
// MUTASJONSBEVIS — konkrete feilendringer disse fanger:
//   • `rankQuizAttempts(scoped, …)` → `rankQuizAttempts(withoutSelf, …)`
//     (rangér previous på feil populasjon) → «previous rangeres MED henne i
//     feltet» ryker: hun finnes ikke i withoutSelf, så previous blir null.
//   • fjern `if (selfWasInField)`-gaten → ingen test ryker på det alene
//     (previous blir uansett null når hun ikke er i feltet), men gaten er en
//     ytelsesvakt, ikke en korrekthetsvakt. Det er ærlig oppgitt her framfor
//     å påstå dekning som ikke finnes. Korrekthetsgaten er `.find()`, og den
//     ER dekket av «deltok ikke gir previous null».
//   • bytt `meg.rank` mot `meg.correct_answers` (eller omvendt) → begge
//     tallene assertes separat, så ombytting ryker.
//   • dropp `rankOptions` og hardkod `includeGuests: true` i previous-kallet
//     → «previous følger org-scope» ryker.

test('previous: rangeres MED henne i feltet — ikke mot det reduserte', () => {
  // Feltet den gangen: Anne 15, MEG 14, Bjørn 12. Hun var nr. 2 av 3.
  // Spøkelsesplasseringen for dagens runde (13) måles mot feltet UTEN henne
  // (Anne 15, Bjørn 12) → 2. plass av 3. Tallene er like her ved en
  // tilfeldighet i nevneren, men rank-kildene er ulike — derfor assertes
  // previous eksplisitt mot sitt eget felt.
  const res = kall({
    field: [
      rad('a', 'anne', 15, 40_000),
      rad('min-gamle', MEG, 14, 55_000),
      rad('b', 'bjorn', 12, 72_000),
    ],
    self: { userId: MEG, correctAnswers: 13, totalTimeMs: 60_000, isTeam: false },
  })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.deepEqual(res.previous, { rank: 2, correctAnswers: 14 })
  // Og spøkelsesplasseringen er fortsatt regnet uten henne.
  assert.equal(res.fieldSize, 2)
})

test('previous: deltok ikke → null, ingen gjetning', () => {
  const res = kall({
    field: [rad('a', 'anne', 15, 40_000), rad('b', 'bjorn', 12, 72_000)],
    self: { userId: MEG, correctAnswers: 13, totalTimeMs: 60_000, isTeam: false },
  })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.equal(res.previous, null)
  assert.equal(res.selfWasInField, false)
})

test('previous: gjesterad gir IKKE previous — samme grense som selfWasInField', () => {
  // Spilte hun originalen uinnlogget, finnes ingen kobling til kontoen.
  // Da skal det heller ikke dukke opp et «du står i dag med»-tall som
  // tilhører en annen person med samme navn.
  const res = kall({
    field: [rad('gjest', null, 14, 55_000)],
    self: { userId: MEG, correctAnswers: 13, totalTimeMs: 60_000, isTeam: false },
  })
  assert.equal(res.kind, 'plassering')
  if (res.kind !== 'plassering') return
  assert.equal(res.previous, null)
})

test('previous følger ORG-scope når org er satt — ikke det globale feltet', () => {
  // Globalt lå hun sist av seks; internt var hun sist av tre. To ulike sanne
  // tall, og kortet viser org-tallet når org-scope er i spill — samme regel
  // som spøkelsesplasseringen selv.
  const field = [
    rad('x1', 'utenfor-1', 15, 40_000),
    rad('x2', 'utenfor-2', 14, 45_000),
    rad('a', 'user-anne', 14, 50_000),
    rad('x3', 'utenfor-3', 13, 47_000),
    rad('b', 'user-bjorn', 11, 66_000),
    rad('min-gamle', MEG, 8, 90_000),
  ]
  const self = { userId: MEG, correctAnswers: 12, totalTimeMs: 60_000, isTeam: false }

  const org = kall({ field, self, orgMemberIds: ELKJOP })
  const globalt = kall({ field, self })
  assert.equal(org.kind, 'plassering')
  assert.equal(globalt.kind, 'plassering')
  if (org.kind !== 'plassering' || globalt.kind !== 'plassering') return
  assert.deepEqual(org.previous, { rank: 3, correctAnswers: 8 })
  assert.deepEqual(globalt.previous, { rank: 6, correctAnswers: 8 })
})

test('previous: blokkert spiller over henne er ute også av det gamle tallet', () => {
  // Paritet med resultatlisten: er noen filtrert bort der, er de filtrert bort
  // her. Ellers ville «står i dag med 3. plass» ikke stemt med listen hun kan
  // åpne — og etterprøvbarheten er hele grunnen til at tallet kan vises.
  const field = [
    rad('a', 'anne', 15, 40_000),
    rad('blokkert', 'user-skjult', 14, 45_000),
    rad('min-gamle', MEG, 12, 70_000),
  ]
  const self = { userId: MEG, correctAnswers: 11, totalTimeMs: 80_000, isTeam: false }

  const utenBlokkert = kall({ field, self, blockedUserIds: new Set(['user-skjult']) })
  const medBlokkert = kall({ field, self })
  assert.equal(utenBlokkert.kind, 'plassering')
  assert.equal(medBlokkert.kind, 'plassering')
  if (utenBlokkert.kind !== 'plassering' || medBlokkert.kind !== 'plassering') return
  assert.deepEqual(utenBlokkert.previous, { rank: 2, correctAnswers: 12 })
  assert.deepEqual(medBlokkert.previous, { rank: 3, correctAnswers: 12 })
})
