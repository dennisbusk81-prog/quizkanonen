// Kjøres med:  npm test
// (krever --experimental-test-module-mocks, se package.json)
//
// SPERRE mot at multi-svar-fasiten kollapser til ett svar i LESE-/VISNINGS-
// stiene: historikk-detaljen (lib/history.ts) og svarfordelingen
// (app/api/quiz/[id]/answer-distribution/route.ts).
//
// BAKGRUNN
// Fram til 2e55e59 (26. juli 2026) selecterte begge kun questions.correct_answer
// (entall), ikke correct_answers (TEXT[]). Et spørsmål med både B og D som
// riktig viste kun B — en spiller som svarte D så ut som om de bommet, i
// historikken sin og i svarfordelingen, selv om svaret var registrert som
// riktig i attempt_answers.
//
// FEILEN LÅ I SELECT-LISTEN, IKKE I MAPPINGEN.
// Det er det avgjørende, og grunnen til at denne filen finnes. Mappingen gikk
// allerede via en fallback som kunne håndtert arrayet — den fikk det bare aldri
// utlevert fra databasen, fordi kolonnen ikke sto i .select(). En kolonne som
// ikke er med i select-listen kommer tilbake som `undefined`, ikke som en feil.
// readStoredKey() faller da stille tilbake på enkelt-kolonnen og returnerer et
// helt plausibelt svar med ett element. Ingen kastet feil, ingen logget noe.
//
// Derfor tester denne filen to ting som lett forveksles:
//   1. at mappingen bruker arrayet når det ER der, og
//   2. at select-listen faktisk BER om det.
// En test som bare gjør (1) ville vært grønn gjennom hele perioden feilen
// levde.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • Fjernes correct_answers fra select-listen i lib/history.ts (nøyaktig den
//     gamle bugen) → «den gamle select-listen mistet det andre riktige svaret»
//     og «select-listen ber faktisk om correct_answers» ryker begge.
//   • Byttes readStoredKey(q) mot [q.correct_answer] i mappingen → «begge
//     riktige svar kommer med» ryker.
//   • Fjernes correct_answers fra select-listen et hvilket som helst annet sted
//     i app/ eller lib/ → den strukturelle sperren nederst ryker, med filnavn.
//   • Endres enkelt-svars-oppførselen → «enkeltsvar er uendret» ryker.
import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Testdata ────────────────────────────────────────────────────────────────
// Ett multi-svar-spørsmål (B og D) og ett vanlig enkeltsvars-spørsmål (C).
// Prod har per 5. august 2026 null spørsmål med mer enn ett riktig svar, så
// multi-svar-stien finnes ikke i ekte data å verifisere mot — den må
// konstrueres her.

const SPM_MULTI = {
  id: 'q-multi',
  question_text: 'Hvilke av disse er primtall?',
  correct_answer: 'B',
  correct_answers: ['B', 'D'],
  option_a: 'Ni',
  option_b: 'Elleve',
  option_c: 'Femten',
  option_d: 'Tretten',
}

const SPM_ENKEL = {
  id: 'q-enkel',
  question_text: 'Hva er hovedstaden i Norge?',
  correct_answer: 'C',
  correct_answers: null,
  option_a: 'Bergen',
  option_b: 'Trondheim',
  option_c: 'Oslo',
  option_d: 'Stavanger',
}

const state: {
  // Når true leveres spørsmålsradene UTEN correct_answers-kolonnen — nøyaktig
  // slik databasen svarte da kolonnen manglet i select-listen.
  simulerGammelSelect: boolean
  // Select-strengen koden faktisk sendte for questions-tabellen.
  questionsSelect: string | null
} = { simulerGammelSelect: false, questionsSelect: null }

type Rad = Record<string, unknown>

function questionRows(): Rad[] {
  const rader: Rad[] = [{ ...SPM_MULTI }, { ...SPM_ENKEL }]
  if (state.simulerGammelSelect) {
    // En kolonne som ikke står i select-listen finnes ikke på raden i det hele
    // tatt. Den kommer ikke tilbake som null — den mangler.
    for (const r of rader) delete r.correct_answers
  }
  return rader
}

// Kjedebygger som speiler supabase-js sitt API så langt lib/history.ts bruker
// det: .from().select().eq()/.in()/.not(), await på kjeden, og .single().
function builder(table: string) {
  let select = ''
  const data = () => {
    switch (table) {
      case 'attempts':
        // To ulike spørringer mot samme tabell: forsøksraden (.single()) og
        // computeRanks sin rangeringsspørring.
        return select.includes('quizzes(title)')
          ? {
              id: 'a-1',
              quiz_id: 'z-1',
              correct_answers: 1,
              total_questions: 2,
              total_time_ms: 8000,
              completed_at: '2026-08-01T18:00:00.000Z',
              quizzes: { title: 'Testquiz' },
            }
          : [{ quiz_id: 'z-1', correct_answers: 1, total_time_ms: 8000 }]
      case 'attempt_answers':
        return [
          // Spilleren svarte D på multi-spørsmålet — ett av to riktige.
          { question_id: 'q-multi', selected_answer: 'D', is_correct: true, time_ms: 4000 },
          { question_id: 'q-enkel', selected_answer: 'A', is_correct: false, time_ms: 4000 },
        ]
      case 'questions':
        return questionRows()
      default:
        return []
    }
  }

  const chain = {
    select(s: string) {
      select = s
      if (table === 'questions') state.questionsSelect = s
      return chain
    },
    eq: () => chain,
    in: () => chain,
    not: () => chain,
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
  state.simulerGammelSelect = false
  state.questionsSelect = null
})

async function multiSvaret() {
  const detalj = await getAttemptDetail('a-1', 'u-1')
  assert.ok(detalj, 'getAttemptDetail returnerte null')
  const svar = detalj.answers.find((a) => a.question_id === 'q-multi')
  assert.ok(svar, 'fant ikke svaret på multi-spørsmålet')
  return svar
}

// ── 1. Mappingen ────────────────────────────────────────────────────────────

test('begge riktige svar kommer med — bokstaver og tekster', async () => {
  const svar = await multiSvaret()
  assert.deepEqual(svar.correct_answers, ['B', 'D'])
  assert.deepEqual(svar.correct_answer_texts, ['Elleve', 'Tretten'])
})

test('spilleren som traff ett av to riktige vises som riktig', async () => {
  // Symptomet brukeren faktisk så: svarte D, D sto ikke i fasiten som ble vist,
  // og raden så ut som en bom selv om is_correct var true.
  const svar = await multiSvaret()
  assert.equal(svar.selected_answer, 'D')
  assert.equal(svar.is_correct, true)
  assert.ok(
    svar.correct_answers.includes(svar.selected_answer!),
    'det valgte svaret mangler i fasiten som vises — dette er nøyaktig bugen'
  )
})

// ── 2. MUTASJONSBEVIS: select-listen er det som bar feilen ──────────────────

test('den gamle select-listen mistet det andre riktige svaret', async () => {
  // Leverer spørsmålsradene uten correct_answers-kolonnen, altså nøyaktig det
  // databasen svarte før 2e55e59. Koden er den samme; bare det den fikk
  // utlevert er endret.
  state.simulerGammelSelect = true
  const svar = await multiSvaret()

  assert.deepEqual(
    svar.correct_answers,
    ['B'],
    'forventet at den gamle formen ga ett svar — hvis ikke beviser ikke testen noe'
  )
  assert.ok(!svar.correct_answers.includes('D'), 'D skulle vært tapt her')
  assert.deepEqual(svar.correct_answer_texts, ['Elleve'])

  // Og den stille delen: spilleren svarte D, som ER riktig, men D står ikke i
  // fasiten som vises. Ingen feil ble kastet, ingenting logget.
  assert.equal(svar.is_correct, true)
  assert.ok(
    !svar.correct_answers.includes('D'),
    'spillerens riktige svar manglet i den viste fasiten'
  )
})

test('select-listen ber faktisk om correct_answers', async () => {
  // Testen over viser hva som skjer NÅR kolonnen mangler. Denne viser at koden
  // ber om den. Uten begge to kunne mappingen vært riktig og spørringen feil —
  // som er akkurat kombinasjonen som levde i prod.
  await getAttemptDetail('a-1', 'u-1')
  assert.ok(state.questionsSelect, 'ingen spørring mot questions ble sendt')
  assert.ok(
    /\bcorrect_answers\b/.test(state.questionsSelect),
    `select-listen mangler correct_answers: ${state.questionsSelect}`
  )
})

// ── 3. Ingen regresjon på enkeltsvar (som er alle spørsmål i prod i dag) ────

test('enkeltsvar er uendret — correct_answers = null gir ett svar', async () => {
  const detalj = await getAttemptDetail('a-1', 'u-1')
  const svar = detalj!.answers.find((a) => a.question_id === 'q-enkel')!
  assert.deepEqual(svar.correct_answers, ['C'])
  assert.deepEqual(svar.correct_answer_texts, ['Oslo'])
  assert.equal(svar.selected_answer, 'A')
  assert.equal(svar.selected_answer_text, 'Bergen')
  assert.equal(svar.is_correct, false)
})

test('enkeltsvar gir identisk resultat med og uten kolonnen i select', async () => {
  // Prod har 0 av 195 spørsmål med mer enn ett riktig svar, så dette er stien
  // ALLE ekte spørsmål går gjennom. Den skal være bit for bit lik før og etter.
  const nytt = (await getAttemptDetail('a-1', 'u-1'))!.answers.find(
    (a) => a.question_id === 'q-enkel'
  )
  state.simulerGammelSelect = true
  const gammelt = (await getAttemptDetail('a-1', 'u-1'))!.answers.find(
    (a) => a.question_id === 'q-enkel'
  )
  assert.deepEqual(gammelt, nytt)
})

// ── 4. Strukturell sperre: ingen select-liste ber om fasiten halvveis ───────

test('ingen select-liste henter correct_answer uten correct_answers', () => {
  // Fasiten er to kolonner som alltid leses sammen (se CLAUDE.md, «Fasit-endring
  // — ÉN kodesti»). En select-liste som nevner correct_answer men ikke
  // correct_answers gjenskaper bugen på en ny flate, og gjør det stille:
  // resultatet ser riktig ut helt til noen lager et spørsmål med to riktige
  // svar.
  //
  // Merk at «correct_answers» selv inneholder delstrengen «correct_answer», så
  // spørringer mot attempts (der correct_answers er et ANTALL, ikke en fasit)
  // passerer uten unntak — de nevner aldri entallsformen alene.
  const rot = join(import.meta.dirname, '..')
  const hoppOver = new Set(['node_modules', '.next', '.git', 'archive'])
  const treff: string[] = []

  const skann = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (hoppOver.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        skann(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(e.name) || e.name.endsWith('.test.ts')) continue

      const kilde = readFileSync(full, 'utf8')
      // Alle streng-literaler som sendes til .select(...).
      for (const m of kilde.matchAll(/\.select\(\s*(['"`])([\s\S]*?)\1/g)) {
        const liste = m[2]
        if (!/\bcorrect_answer\b/.test(liste)) continue
        if (/\bcorrect_answers\b/.test(liste)) continue
        treff.push(`${full}: ${liste.trim().slice(0, 120)}`)
      }
    }
  }
  for (const mappe of ['app', 'components', 'lib']) skann(join(rot, mappe))

  assert.deepEqual(
    treff,
    [],
    'select-liste henter correct_answer uten correct_answers — multi-svar ' +
    'kollapser stille til ett svar her'
  )
})
