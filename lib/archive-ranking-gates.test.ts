// Kjøres med:  npm test
//
// OPPFØRSELSTEST av de åtte arkiv-gatene på spillestiens rangeringskall.
// Wiringen — at app/quiz/[id]/page.tsx faktisk spør disse funksjonene — er
// dekket av lib/archive-ranking-wiring.test.ts. De to hører sammen: denne
// filen alene ville godtatt at kallstedene sluttet å kalle predikatene, og
// wiring-filen alene ville godtatt at predikatene svarte feil.
//
// ── BEGGE RETNINGER, ALLTID ─────────────────────────────────────────────────
// Hver gate testes to ganger: at den TIER for quiz_type='archive', og at den
// FORTSATT FYRER for 'weekly'. Den andre halvdelen er ikke pynt. En test som
// bare beviser at noe er av, godtar at alt er av — og det er nøyaktig den
// regresjonen som er lettest å innføre ved et uhell her, siden alle åtte
// vaktene ble skrevet i samme runde og en overivrig opprydding kunne gjort
// dem ubetingede.
//
// 'bonus' er med i noen tilfeller fordi lib/real-quiz-population.ts sin
// hviteliste er ['weekly', 'bonus'] — en gate som bare slapp gjennom 'weekly'
// ville gjort bonusquizer stille rangeringsløse.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes isArchiveQuiz-sjekken fra en gate → dens «tier for arkiv» ryker.
//   • Snus en gate til å returnere false ubetinget → dens «fyrer for weekly» ryker.
//   • Fjernes arkiv-leddet fra KUN én av G6/G7 → «premium-spilleren faller ikke
//     ned i spenn-stien» ryker, selv om begge de enkle testene består.
//   • Byttes `=== 'archive'` mot f.eks. `=== 'arkiv'` → alle åtte «tier»-testene ryker.
//   • Gjøres ukjent quiztype til «arkiv» → «ukjent quiztype behandles som
//     ikke-arkiv» ryker.
//   • Droppes showLivePlacement eller terskelen fra G4 → de to G4-testene ryker.
//   • Droppes hasAccessToken fra G5 → «rival krever token» ryker.
//   • Droppes fase-vilkåret fra G1/G3 → deres fase-tester ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isArchiveQuiz,
  shouldFetchInternalPlacement,
  shouldFetchAlreadyPlayedTop3OnLoad,
  shouldFetchPhaseTop3,
  shouldFetchLiveRank,
  shouldFetchRival,
  shouldFetchPremiumInterludeRanking,
  shouldFetchSpanInterludeRanking,
  shouldFetchFinishExtras,
} from '@/lib/archive-ranking-gates'

const ARCHIVE = 'archive'
const WEEKLY = 'weekly'
const BONUS = 'bonus'

// ── isArchiveQuiz — den delte kjernen ───────────────────────────────────────

test('isArchiveQuiz: kun den bokstavelige strengen «archive» er arkiv', () => {
  assert.equal(isArchiveQuiz(ARCHIVE), true)
  assert.equal(isArchiveQuiz(WEEKLY), false)
  assert.equal(isArchiveQuiz(BONUS), false)
  assert.equal(isArchiveQuiz('test'), false)
  // Ingen normalisering: kolonnen er en enum-lignende tekst skrevet av
  // arkiv-kopiruten, aldri av en bruker. Godtok vi 'Archive' her ville
  // gaten begynt å gjette på data den ikke får.
  assert.equal(isArchiveQuiz('Archive'), false)
})

test('isArchiveQuiz: ukjent quiztype behandles som IKKE-arkiv', () => {
  // Speiler begge formene som sto i komponenten fra før:
  // `quiz?.quiz_type !== 'archive'` og `!(quiz?.quiz_type === 'archive')` er
  // begge sanne når raden ikke er lastet. Uoppnåelig på alle åtte kallstedene,
  // men bundet fast her fordi to ulike skrivemåter måtte oppføre seg likt.
  assert.equal(isArchiveQuiz(null), false)
  assert.equal(isArchiveQuiz(undefined), false)
})

// ── G1: intern org-plassering (/api/leaderboard/{id}?org=) ──────────────────

test('G1 intern org-plassering: TIER for arkiv', () => {
  assert.equal(shouldFetchInternalPlacement({
    quizType: ARCHIVE, phase: 'finished', placementMode: 'internal-only',
  }), false)
  assert.equal(shouldFetchInternalPlacement({
    quizType: ARCHIVE, phase: 'finished', placementMode: 'both',
  }), false)
})

test('G1 intern org-plassering: FYRER fortsatt for fredagsquiz', () => {
  assert.equal(shouldFetchInternalPlacement({
    quizType: WEEKLY, phase: 'finished', placementMode: 'internal-only',
  }), true)
  assert.equal(shouldFetchInternalPlacement({
    quizType: WEEKLY, phase: 'finished', placementMode: 'both',
  }), true)
  assert.equal(shouldFetchInternalPlacement({
    quizType: BONUS, phase: 'finished', placementMode: 'both',
  }), true)
})

test('G1: de øvrige vilkårene består — fase og visningsmodus', () => {
  // Uten disse ville gaten hentet org-plassering midt i spillingen, og for
  // spillere som ikke har noen org-visning i det hele tatt.
  assert.equal(shouldFetchInternalPlacement({
    quizType: WEEKLY, phase: 'playing', placementMode: 'both',
  }), false)
  assert.equal(shouldFetchInternalPlacement({
    quizType: WEEKLY, phase: 'already_played', placementMode: 'both',
  }), false)
  assert.equal(shouldFetchInternalPlacement({
    quizType: WEEKLY, phase: 'finished', placementMode: 'public',
  }), false)
  assert.equal(shouldFetchInternalPlacement({
    quizType: WEEKLY, phase: 'finished', placementMode: 'none',
  }), false)
})

// ── G2: topp-3 i fetchData sin already_played-gren (/standings) ─────────────

test('G2 topp-3 ved innlasting: TIER for arkiv', () => {
  assert.equal(shouldFetchAlreadyPlayedTop3OnLoad({ quizType: ARCHIVE }), false)
})

test('G2 topp-3 ved innlasting: FYRER fortsatt for fredagsquiz', () => {
  assert.equal(shouldFetchAlreadyPlayedTop3OnLoad({ quizType: WEEKLY }), true)
  assert.equal(shouldFetchAlreadyPlayedTop3OnLoad({ quizType: BONUS }), true)
})

// ── G3: topp-3 fra fase-effekten (/standings) ──────────────────────────────

test('G3 topp-3 fra fase-effekten: TIER for arkiv', () => {
  assert.equal(shouldFetchPhaseTop3({ quizType: ARCHIVE, phase: 'already_played' }), false)
})

test('G3 topp-3 fra fase-effekten: FYRER fortsatt for fredagsquiz', () => {
  assert.equal(shouldFetchPhaseTop3({ quizType: WEEKLY, phase: 'already_played' }), true)
  assert.equal(shouldFetchPhaseTop3({ quizType: BONUS, phase: 'already_played' }), true)
})

test('G3: kun already_played — «finished» henter topp-3 i finishQuiz i stedet', () => {
  // Hentes den også her, kan de to divergere: to /standings-kall i to ulike
  // øyeblikk mot en liste som fortsatt endrer seg mens quizen er åpen.
  assert.equal(shouldFetchPhaseTop3({ quizType: WEEKLY, phase: 'finished' }), false)
  assert.equal(shouldFetchPhaseTop3({ quizType: WEEKLY, phase: 'playing' }), false)
})

test('G2 og G3 er BEGGE gatet — dobbelthentingen har to innganger', () => {
  // Topp-3 for already_played hentes fra to uavhengige steder med vilje
  // (fase-effekten kan miste fase-endringen pga. timing med loading-state).
  // Gates bare den ene, henter den andre likevel — og arkivspilleren ser
  // «Topp 3» med seg selv alene. Denne testen binder paret sammen, slik at
  // en fjernet gate ikke kan gjemme seg bak den andres test.
  assert.equal(shouldFetchAlreadyPlayedTop3OnLoad({ quizType: ARCHIVE }), false)
  assert.equal(shouldFetchPhaseTop3({ quizType: ARCHIVE, phase: 'already_played' }), false)
})

// ── G4: live plassering under spilling (/ranking-snapshot) ─────────────────

test('G4 live plassering: TIER for arkiv', () => {
  assert.equal(shouldFetchLiveRank({
    quizType: ARCHIVE, showLivePlacement: true, answeredSoFar: 5, minAnsweredForPlacement: 3,
  }), false)
})

test('G4 live plassering: FYRER fortsatt for fredagsquiz', () => {
  assert.equal(shouldFetchLiveRank({
    quizType: WEEKLY, showLivePlacement: true, answeredSoFar: 3, minAnsweredForPlacement: 3,
  }), true)
  assert.equal(shouldFetchLiveRank({
    quizType: BONUS, showLivePlacement: true, answeredSoFar: 9, minAnsweredForPlacement: 3,
  }), true)
})

test('G4: quizens eget flagg og terskelen består', () => {
  assert.equal(shouldFetchLiveRank({
    quizType: WEEKLY, showLivePlacement: false, answeredSoFar: 9, minAnsweredForPlacement: 3,
  }), false)
  assert.equal(shouldFetchLiveRank({
    quizType: WEEKLY, showLivePlacement: null, answeredSoFar: 9, minAnsweredForPlacement: 3,
  }), false)
  // Under terskelen: mellomskjermen sier at plasseringen vises fra tredje
  // svar, i stedet for å vise et anslag bygget på ett–to svar.
  assert.equal(shouldFetchLiveRank({
    quizType: WEEKLY, showLivePlacement: true, answeredSoFar: 2, minAnsweredForPlacement: 3,
  }), false)
})

// ── G5: rival + rankingSnapshot + duellforslag (/api/quiz/rival) ───────────

test('G5 rival: TIER for arkiv', () => {
  assert.equal(shouldFetchRival({ quizType: ARCHIVE, hasAccessToken: true }), false)
})

test('G5 rival: FYRER fortsatt for fredagsquiz', () => {
  assert.equal(shouldFetchRival({ quizType: WEEKLY, hasAccessToken: true }), true)
  assert.equal(shouldFetchRival({ quizType: BONUS, hasAccessToken: true }), true)
})

test('G5: rival krever token — en gjest spør ikke', () => {
  assert.equal(shouldFetchRival({ quizType: WEEKLY, hasAccessToken: false }), false)
})

// ── G6 + G7: mellomskjermen i goToNext ────────────────────────────────────

test('G6 premium-rangering på mellomskjermen: TIER for arkiv', () => {
  assert.equal(shouldFetchPremiumInterludeRanking({
    quizType: ARCHIVE, isLoggedIn: true, isPremium: true, placementReady: true,
  }), false)
})

test('G6 premium-rangering på mellomskjermen: FYRER fortsatt for fredagsquiz', () => {
  assert.equal(shouldFetchPremiumInterludeRanking({
    quizType: WEEKLY, isLoggedIn: true, isPremium: true, placementReady: true,
  }), true)
  assert.equal(shouldFetchPremiumInterludeRanking({
    quizType: BONUS, isLoggedIn: true, isPremium: true, placementReady: true,
  }), true)
})

test('G7 spenn-rangering på mellomskjermen: TIER for arkiv', () => {
  assert.equal(shouldFetchSpanInterludeRanking({
    quizType: ARCHIVE, isLoggedIn: true, isPremium: false, placementReady: true,
  }), false)
})

test('G7 spenn-rangering på mellomskjermen: FYRER fortsatt for fredagsquiz', () => {
  assert.equal(shouldFetchSpanInterludeRanking({
    quizType: WEEKLY, isLoggedIn: true, isPremium: false, placementReady: true,
  }), true)
  assert.equal(shouldFetchSpanInterludeRanking({
    quizType: BONUS, isLoggedIn: true, isPremium: false, placementReady: true,
  }), true)
})

test('G6/G7: innlogging og terskel består på begge stiene', () => {
  assert.equal(shouldFetchPremiumInterludeRanking({
    quizType: WEEKLY, isLoggedIn: false, isPremium: true, placementReady: true,
  }), false)
  assert.equal(shouldFetchPremiumInterludeRanking({
    quizType: WEEKLY, isLoggedIn: true, isPremium: true, placementReady: false,
  }), false)
  assert.equal(shouldFetchSpanInterludeRanking({
    quizType: WEEKLY, isLoggedIn: false, isPremium: false, placementReady: true,
  }), false)
  assert.equal(shouldFetchSpanInterludeRanking({
    quizType: WEEKLY, isLoggedIn: true, isPremium: false, placementReady: false,
  }), false)
})

test('G6/G7: premium-spilleren faller ikke ned i spenn-stien på en arkivquiz', () => {
  // DEN VIKTIGE. De to gatene deler `isLoggedIn && placementReady` og splittes
  // på isPremium. Fjernes arkiv-leddet fra KUN én av dem, består begge de
  // enkle testene over — men en premium-spiller på en arkivquiz treffer da den
  // andre stien og får et rangeringskall likevel. Denne testen sier at
  // mellomskjermen er STILLE for arkiv, uansett hvilken av de to stiene
  // spilleren tilhører.
  for (const isPremium of [true, false]) {
    const felles = { quizType: ARCHIVE, isLoggedIn: true, placementReady: true, isPremium }
    assert.equal(shouldFetchPremiumInterludeRanking(felles), false,
      `premium-stien fyrte for arkiv med isPremium=${isPremium}`)
    assert.equal(shouldFetchSpanInterludeRanking(felles), false,
      `spenn-stien fyrte for arkiv med isPremium=${isPremium}`)
  }
})

test('G6/G7: nøyaktig ÉN av de to stiene fyrer for en fredagsquiz', () => {
  // Speilbildet av testen over, og grunnen til at «tier for arkiv» ikke kan
  // oppfylles ved å slå av begge for alle: for weekly skal dekningen være
  // komplett og ikke-overlappende.
  for (const isPremium of [true, false]) {
    const felles = { quizType: WEEKLY, isLoggedIn: true, placementReady: true, isPremium }
    const traff = [
      shouldFetchPremiumInterludeRanking(felles),
      shouldFetchSpanInterludeRanking(felles),
    ].filter(Boolean).length
    assert.equal(traff, 1,
      `forventet nøyaktig én rangeringssti for weekly med isPremium=${isPremium}, fikk ${traff}`)
  }
})

// ── G8: pynte-blokken ved målstreken (finishQuiz) ─────────────────────────

test('G8 målstrek-ekstrautstyr: TIER for arkiv', () => {
  assert.equal(shouldFetchFinishExtras({ quizType: ARCHIVE }), false)
})

test('G8 målstrek-ekstrautstyr: FYRER fortsatt for fredagsquiz', () => {
  assert.equal(shouldFetchFinishExtras({ quizType: WEEKLY }), true)
  assert.equal(shouldFetchFinishExtras({ quizType: BONUS }), true)
})

// ── Samlet: ingen av de åtte kan bli ubetinget ────────────────────────────

test('KRAV: alle åtte gatene tier for arkiv OG fyrer for weekly', () => {
  // Ett sted som feller «noen gjorde alle gatene ubetingede i én opprydding»
  // — enten ved å skru dem alle av (andre løkke) eller alle på (første).
  const kall = (quizType: QuizTypeArg) => [
    shouldFetchInternalPlacement({ quizType, phase: 'finished', placementMode: 'both' }),
    shouldFetchAlreadyPlayedTop3OnLoad({ quizType }),
    shouldFetchPhaseTop3({ quizType, phase: 'already_played' }),
    shouldFetchLiveRank({ quizType, showLivePlacement: true, answeredSoFar: 5, minAnsweredForPlacement: 3 }),
    shouldFetchRival({ quizType, hasAccessToken: true }),
    shouldFetchPremiumInterludeRanking({ quizType, isLoggedIn: true, isPremium: true, placementReady: true }),
    shouldFetchSpanInterludeRanking({ quizType, isLoggedIn: true, isPremium: false, placementReady: true }),
    shouldFetchFinishExtras({ quizType }),
  ]

  const forArkiv = kall(ARCHIVE)
  assert.equal(forArkiv.length, 8, 'forventet åtte gater — er en lagt til uten test?')
  assert.deepEqual(forArkiv, new Array(8).fill(false),
    `minst én gate fyrte for en arkivquiz: ${JSON.stringify(forArkiv)}`)

  const forWeekly = kall(WEEKLY)
  assert.deepEqual(forWeekly, new Array(8).fill(true),
    `minst én gate tidde for en fredagsquiz: ${JSON.stringify(forWeekly)}`)
})

type QuizTypeArg = string | null | undefined
