// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// SPERRE for lenken videre fra /historikk/[attemptId] til quizens
// resultatliste — og for at den ikke vises når den fører til en blindvei.
//
// BAKGRUNN
// «Din siste quiz»-kortet på /historikk hadde to lenker videre; detaljsiden
// for et ELDRE forsøk hadde ingen. Samme quiz, samme bruker, ulik tilgang
// avhengig av om forsøket tilfeldigvis var det ferskeste. Lenken er lagt til
// 24. august 2026.
//
// MEN målsiden er ikke alltid der. To quiz-tilstander gjør /leaderboard/[id]
// til en blindvei, og de er ULIKE blindveier:
//
//   • is_active = false («Skjul» i admin) — RLS-policyen quizzes_select_active
//     gir klienten null rader, .single() feiler, og siden tegner «Noe gikk
//     galt. Prøv å laste siden på nytt.»
//   • show_leaderboard = false — siden sier «Resultater er ikke aktivert
//     for denne quizen».
//
// DERFOR MÅ BEGGE FLAGGENE STÅ I SELECT-LISTEN, og det er hovedpoenget med
// denne filen. En kolonne som ikke er med i .select() kommer tilbake som
// `undefined`, ikke som en feil (samme feilklasse som
// lib/answer-key-display.test.ts finnes for). Med `undefined` faller
// resolveQuizFlag på sin dokumenterte standardverdi `true` — altså «vis
// lenken» — og gaten blir stille virkningsløs. En test på selve gate-uttrykket
// ville ikke fanget det, for uttrykket ville vært helt korrekt.
//
// MUTASJONSBEVIS — hver mutasjon er faktisk kjørt 24. august 2026, og tallet
// er antall tester som ble røde. Merk at «den gamle embeden gjorde gaten
// virkningsløs» IKKE er en sperre mot den gamle select-listen: den demonstrerer
// hva undefined-formen gir, og overlever derfor mutasjon M1. Sperren mot M1 er
// select-testen alene.
//   M1  is_active/show_leaderboard fjernet fra quizzes-embeden i lib/history.ts
//       → 1: «select-listen ber faktisk om begge flaggene»
//   M2  standardverdien i resolveQuizFlag snudd fra true til false
//       → 2: «ulesbart flagg faller ÅPENT» + «den gamle embeden gjorde gaten
//            virkningsløs»
//   M3  array-formen droppes (embeden antas alltid å være et objekt)
//       → 1: «array-formen fra PostgREST leses også»
//   M4  detail.quiz_is_active fjernet fra gate-uttrykket
//       → 1: «detaljsiden gater leaderboard-lenken på BEGGE flaggene»
//   M5  detail.quiz_show_leaderboard fjernet fra gate-uttrykket
//       → 1: samme test
//   M6  cache-nøkkelen rullet tilbake til qk_attempt_v2
//       → 1: «cache-nøkkelen ble bumpet»
//   M7  Link-en til /historikk i lenkeraden peker et annet sted
//       → 1: «detaljsiden har en ekte Link tilbake til historikken»
//       (FØRSTE forsøk på denne testen var GRØNN under M7 — ankeret var et
//        bart href="/historikk", som «Ikke funnet»-tilstandens gull-knapp
//        allerede oppfyller. Ankeret krever nå style={s.lenke}.)
//   M8  hele lenkeraden pakket inn i en JSX-kommentar
//       → 2: begge de strukturelle sperrene (beviser at kommentar-strippingen
//            er ankeret, ikke bare navnene som står i kommentarene)
//   M9  tilbake-lenken fjernet fra fetchError-grenen i /leaderboard/[id]
//       → 1: «en skjult quiz lander ikke i en blindvei uten utvei»
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Testtilstand ────────────────────────────────────────────────────────────

const state: {
  // Hva quizzes-embeden leverer på forsøksraden. `undefined` betyr at feltet
  // ikke finnes på raden i det hele tatt — nøyaktig slik en kolonne utenfor
  // select-listen oppfører seg.
  isActive: unknown
  showLeaderboard: unknown
  // Leverer embeden som array i stedet for objekt (PostgREST kan gjøre begge,
  // avhengig av hvordan relasjonen tolkes).
  embedSomArray: boolean
  // Select-strengen koden faktisk sendte for forsøksraden.
  attemptSelect: string | null
} = {
  isActive: true,
  showLeaderboard: true,
  embedSomArray: false,
  attemptSelect: null,
}

function quizEmbed(): unknown {
  const rad: Record<string, unknown> = { title: 'Fredagsquiz 21.08' }
  if (state.isActive !== undefined) rad.is_active = state.isActive
  if (state.showLeaderboard !== undefined) rad.show_leaderboard = state.showLeaderboard
  return state.embedSomArray ? [rad] : rad
}

// Kjedebygger som speiler supabase-js så langt lib/history.ts bruker det.
function builder(table: string) {
  let select = ''
  const data = () => {
    switch (table) {
      case 'attempts':
        // To ulike spørringer mot samme tabell: forsøksraden (.single(), den
        // eneste som har quizzes-embeden) og fetchFieldStats, som teller
        // deltakere per quiz.
        return select.includes('quizzes(')
          ? {
              id: 'a-1',
              quiz_id: 'z-1',
              correct_answers: 1,
              total_questions: 1,
              total_time_ms: 5000,
              completed_at: '2026-08-21T18:00:00.000Z',
              quizzes: quizEmbed(),
            }
          : [{ quiz_id: 'z-1', correct_answers: 1 }]
      case 'season_scores':
        return [{ user_id: 'u-1', quiz_id: 'z-1', rank: 1 }]
      case 'attempt_answers':
        return [{ question_id: 'q-1', selected_answer: 'A', is_correct: true, time_ms: 5000 }]
      case 'questions':
        return [{
          id: 'q-1',
          question_text: 'Hva er hovedstaden i Norge?',
          correct_answer: 'A',
          correct_answers: null,
          option_a: 'Oslo',
          option_b: 'Bergen',
          option_c: 'Trondheim',
          option_d: 'Stavanger',
        }]
      default:
        return []
    }
  }

  const chain = {
    select(s: string) {
      select = s
      if (table === 'attempts' && s.includes('quizzes(')) state.attemptSelect = s
      return chain
    },
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    range: () => chain,
    single: async () => ({ data: data(), error: null }),
    then: (
      res: (v: { data: unknown; error: null }) => unknown,
      rej?: (e: unknown) => unknown
    ) => Promise.resolve({ data: data(), error: null }).then(res, rej),
  }
  return chain
}

mock.module('@/lib/supabase-admin', {
  namedExports: { supabaseAdmin: { from: (table: string) => builder(table) } },
})

const { getAttemptDetail } = await import('@/lib/history')

beforeEach(() => {
  state.isActive = true
  state.showLeaderboard = true
  state.embedSomArray = false
  state.attemptSelect = null
})

async function detalj() {
  const d = await getAttemptDetail('a-1', 'u-1')
  assert.ok(d, 'getAttemptDetail returnerte null')
  return d
}

// ── 1. Flaggene kommer gjennom ──────────────────────────────────────────────

test('en normal quiz gir begge flaggene true — lenken skal vises', async () => {
  const d = await detalj()
  assert.equal(d.quiz_is_active, true)
  assert.equal(d.quiz_show_leaderboard, true)
})

test('skjult quiz (is_active=false) bæres videre som false', async () => {
  state.isActive = false
  const d = await detalj()
  assert.equal(d.quiz_is_active, false, 'en skjult quiz må kunne skjule lenken')
  assert.equal(d.quiz_show_leaderboard, true, 'det andre flagget skal ikke smitte')
})

test('resultater avskrudd (show_leaderboard=false) bæres videre som false', async () => {
  state.showLeaderboard = false
  const d = await detalj()
  assert.equal(d.quiz_show_leaderboard, false)
  assert.equal(d.quiz_is_active, true, 'det andre flagget skal ikke smitte')
})

test('array-formen fra PostgREST leses også', async () => {
  // Samme forsvar som resolveTitle/resolveCategory: embeden kan komme som
  // objekt eller array, og å anta feil form gir undefined uten feilmelding —
  // som her ville betydd «lenken vises alltid», altså gaten slått av.
  state.embedSomArray = true
  state.isActive = false
  const d = await detalj()
  assert.equal(d.quiz_is_active, false, 'array-formen ble ikke lest')
})

// ── 2. MUTASJONSBEVIS: select-listen er det som bærer gaten ─────────────────

test('den gamle embeden gjorde gaten virkningsløs', async () => {
  // Nøyaktig det databasen svarer når kolonnene ikke står i select-listen:
  // feltene finnes ikke på raden. Koden er den samme; bare det den fikk
  // utlevert er endret.
  state.isActive = undefined
  state.showLeaderboard = undefined
  const d = await detalj()

  // Begge blir true — altså «vis lenken» — for ENHVER quiz, også en skjult.
  // Gate-uttrykket på detaljsiden ville vært helt korrekt og likevel aldri
  // gripe. Dette er hele grunnen til testen under.
  assert.equal(d.quiz_is_active, true)
  assert.equal(d.quiz_show_leaderboard, true)
})

test('select-listen ber faktisk om begge flaggene', async () => {
  await getAttemptDetail('a-1', 'u-1')
  assert.ok(state.attemptSelect, 'ingen forsøksrad-spørring ble sendt')
  assert.ok(
    /\bis_active\b/.test(state.attemptSelect),
    `select-listen mangler is_active: ${state.attemptSelect}`
  )
  assert.ok(
    /\bshow_leaderboard\b/.test(state.attemptSelect),
    `select-listen mangler show_leaderboard: ${state.attemptSelect}`
  )
})

test('ulesbart flagg faller ÅPENT, ikke lukket', async () => {
  // Bevisst motsatt av fail-safen i /api/leaderboard/[id]: der holdes ANDRE
  // spilleres rader tilbake, og en blipp skal ikke kunne åpne en skjult
  // stilling. Her er utfallet en navigasjonslenke uten sikkerhetsdimensjon,
  // og flaggene leses i SAMME .single() som selve forsøket — er de ulesbare,
  // lastet ikke forsøket heller. Å falle lukket ville stille fjernet en lenke
  // som virker.
  state.isActive = 'ja'          // ikke boolean
  state.showLeaderboard = null   // heller ikke boolean
  const d = await detalj()
  assert.equal(d.quiz_is_active, true)
  assert.equal(d.quiz_show_leaderboard, true)
})

// ── 3. Strukturelle sperrer på klientsiden ──────────────────────────────────

const ROT = join(import.meta.dirname, '..')
const DETALJSIDE = join(ROT, 'app', 'historikk', '[attemptId]', 'page.tsx')

// Kommentarer strippes FØR alle regex-sjekkene under. Uten det ville en
// utkommentert gate — eller bare kommentarene fra denne runden, som nevner
// både feltnavnene og ruten — holdt testene grønne. Se
// lib/answer-key-display.test.ts for samme grep.
function utenKommentarer(kilde: string): string {
  return kilde
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

test('detaljsiden gater leaderboard-lenken på BEGGE flaggene', () => {
  const kode = utenKommentarer(readFileSync(DETALJSIDE, 'utf8'))

  assert.ok(
    kode.includes('/leaderboard/${detail.quiz_id}'),
    'detaljsiden lenker ikke til quizens resultatliste i det hele tatt'
  )
  assert.ok(
    /detail\.quiz_is_active\s*&&/.test(kode),
    'lenken gates ikke på quiz_is_active — en skjult quiz gir «Noe gikk galt»'
  )
  assert.ok(
    /detail\.quiz_show_leaderboard\s*&&/.test(kode),
    'lenken gates ikke på quiz_show_leaderboard — fører til «ikke aktivert»-skjermen'
  )
})

test('detaljsiden har en ekte Link tilbake til historikken', () => {
  // ← Tilbake øverst er router.back(), som ikke fører noe sted når siden
  // åpnes direkte fra en delt lenke eller i ny fane.
  //
  // Ankeret krever style={s.lenke}, altså lenkeraden under hero-kortet. Et
  // bart href="/historikk" holder IKKE: «Ikke funnet»-tilstanden har hatt en
  // slik lenke hele tiden (gull-knappen), og mutasjonsrunden 24. august viste
  // at testen da forble grønn med lenkeraden borte. Grep teller navn, ikke
  // plassering.
  const kode = utenKommentarer(readFileSync(DETALJSIDE, 'utf8'))
  assert.ok(
    /href="\/historikk"\s+style=\{s\.lenke\}/.test(kode),
    'ingen Link til /historikk i lenkeraden — direkte åpning har da ingen vei videre'
  )
})

test('en skjult quiz lander ikke i en blindvei uten utvei', () => {
  // Søskenet til gaten over, og grunnen til at den finnes: gaten hindrer at
  // NYE brukere sendes hit, men lenken har ligget på «Din siste quiz»-kortet
  // hele tiden, og en delt URL fungerer uansett. Skjules quizen i admin
  // (is_active = false) gir RLS-policyen quizzes_select_active null rader,
  // .single() feiler, og siden tegnet «Noe gikk galt» UTEN noen lenke videre.
  //
  // Samme mønster som «historikk: feiltilstanden har en vei videre»
  // (lib/historikk-load-catch.test.ts) — og show_leaderboard-grenen rett under
  // i samme fil hadde utveien allerede.
  const kode = utenKommentarer(
    readFileSync(join(ROT, 'app', 'leaderboard', '[id]', 'page.tsx'), 'utf8')
  )
  //
  // Vinduet slutter ved NESTE gren, ikke etter et antall tegn: de to grenene
  // ligger rett etter hverandre, og show_leaderboard-grenen har sin egen
  // «← Tilbake til forsiden». Et tegnbasert vindu leste den, og testen forble
  // grønn med lenken i !quiz-grenen fjernet (mutasjon M9, 24. august).
  const start = kode.indexOf('if (!quiz) return')
  assert.notEqual(start, -1, 'fant ikke !quiz-grenen i /leaderboard/[id]')
  const slutt = kode.indexOf('if (!quiz.show_leaderboard)', start)
  assert.notEqual(slutt, -1, 'fant ikke show_leaderboard-grenen — vinduet er ikke avgrenset')
  assert.ok(
    /href="\//.test(kode.slice(start, slutt)),
    'feilskjermen for en skjult quiz mangler vei videre — brukeren står fast'
  )
})

test('cache-nøkkelen ble bumpet da AttemptDetail fikk nye felt', () => {
  // Bufrede svar overlever skjemaendringer: sessionStorage-payloaden lever i
  // 10 minutter, og en v2-payload fra før denne endringen mangler begge
  // flaggene. Uten bump ville en Premium-bruker mistet lenken i opptil ti
  // minutter etter deploy, uten at noe var galt med quizen.
  const filer = [
    join(ROT, 'app', 'historikk', 'page.tsx'),
    DETALJSIDE,
  ]
  for (const f of filer) {
    const kode = readFileSync(f, 'utf8')
    assert.ok(
      !/qk_attempt_v2_/.test(kode),
      `${f} bruker fortsatt den gamle cache-nøkkelen qk_attempt_v2_`
    )
    assert.ok(
      /qk_attempt_v3_/.test(kode),
      `${f} mangler den bumpede cache-nøkkelen qk_attempt_v3_`
    )
  }
})
