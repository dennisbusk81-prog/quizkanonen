// Kjøres med:  npm test
//
// MUTASJONSBEVIS for stale-closure-risikoen i timer-effekten i
// app/quiz/[id]/page.tsx (5. august 2026).
//
// ── ÆRLIG BEGRENSNING, LES DENNE FØRST ───────────────────────────────────────
// React-semantikken under er en MODELL, ikke ekte React. Prosjektet har verken
// jsdom eller react-testing-library, så komponenten kan ikke rendres i en test.
// Modellen gjengir de tre reglene beviset hviler på:
//   1. Hver render lager en NY closure over gjeldende state.
//   2. En effekt kjører kun på nytt når deps-arrayet endrer seg.
//   3. En callback effekten beholder (setTimeout/setInterval/lytter), holder på
//      closuren fra den renderen effekten SIST kjørte i.
// Alt annet — batching, concurrent rendering, StrictMode — er utenfor modellen.
//
// Det som IKKE er en modell: record-byggingen. Testene kaller den ekte
// buildTimeoutAnswer og withAnswer fra lib/quiz-timeout-answer.ts, som er
// nøyaktig koden handleTimeout kjører i produksjon. Det er derfor logikken ble
// flyttet ut av page.tsx — uten den flyttingen ville hele testen vært modell.
//
// ── HVA BEVISET VISER ────────────────────────────────────────────────────────
// Kostnaden ved en utdatert closure her er IKKE feil svartid. withAnswer bygger
// et NYTT array fra den closuren har fanget, så et gammelt `answers` betyr at
// hvert svar registrert siden da forsvinner sporløst ut av payloaden til
// /submit. Spilleren mister poeng for spørsmål de faktisk svarte riktig på.
//
// MUTASJONER hver test feller:
//   • Endres timer-effekten så handleTimeout kalles fra en UTSATT callback
//     (pause-funksjon, setInterval, annen timer-implementasjon) OG bindingen
//     går via closure i stedet for ref → «utsatt kallsted + closure mister
//     svar» viser nøyaktig tapet, og «utsatt kallsted + ref beholder alt» ryker.
//   • Byttes handleTimeoutRef.current() tilbake til handleTimeout() i page.tsx
//     → den strukturelle sperren nederst ryker.
//   • Flyttes sync-effekten NEDENFOR timer-effekten (da er ref-en én commit på
//     etterskudd) → rekkefølge-sperren ryker.
//   • Summeres newTimeMs ved inkrement i stedet for fra newAnswers → «erstattet
//     svar bytter ut tiden, ikke legger til» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildTimeoutAnswer, withAnswer, type AnswerRecord } from '@/lib/quiz-timeout-answer'

const ans = (id: string, timeMs: number): AnswerRecord =>
  ({ questionId: id, selectedAnswer: 'A', isCorrect: true, timeMs })

// ─────────────────────────────────────────────────────────────────────────────
// DEL 1 — den rene logikken (ekte produksjonskode, ingen modell)
// ─────────────────────────────────────────────────────────────────────────────

test('timeout-svar registreres som ubesvart med full tidsgrense', () => {
  const { record } = buildTimeoutAnswer({
    questionId: 'q1', timeLimitSeconds: 20, answers: [],
  })
  // selectedAnswer: null er meningsbærende — /submit skiller ubesvart fra feil.
  assert.equal(record.selectedAnswer, null)
  assert.equal(record.isCorrect, false)
  assert.equal(record.timeMs, 20_000)
})

test('timeout på et allerede besvart spørsmål ERSTATTER svaret, dupliserer ikke', () => {
  const answers = [ans('q1', 4000), ans('q2', 5000)]
  const { newAnswers, newTimeMs } = buildTimeoutAnswer({
    questionId: 'q2', timeLimitSeconds: 30, answers,
  })
  assert.equal(newAnswers.filter(a => a.questionId === 'q2').length, 1)
  // 4000 + 30000 — den gamle q2-tiden (5000) er BYTTET UT, ikke lagt til.
  // Et inkrement fra forrige totalTimeMs ville gitt 39000 og skjøvet spilleren
  // ned på tiebreakeren i topplista.
  assert.equal(newTimeMs, 34_000)
})

test('newTimeMs summeres fra newAnswers, ikke fra en teller utenfor', () => {
  const answers = [ans('q1', 4000), ans('q2', 5000)]
  const { newAnswers, newTimeMs } = buildTimeoutAnswer({
    questionId: 'q3', timeLimitSeconds: 30, answers,
  })
  assert.equal(newTimeMs, newAnswers.reduce((s, a) => s + a.timeMs, 0))
  assert.equal(newTimeMs, 39_000)
})

// ─────────────────────────────────────────────────────────────────────────────
// DEL 2 — modellen av React sin closure-/deps-semantikk
//
// `binding` er de to måtene timer-effekten kan nå handleTimeout på:
//   'closure' — funksjonen fanget fra renderen effekten sist kjørte i
//               (det manglende deps-elementet, slik koden var før 5. august)
//   'ref'     — handleTimeoutRef.current, oppdatert på hver commit
//               (fiksen)
// ─────────────────────────────────────────────────────────────────────────────

type Binding = 'closure' | 'ref'

/**
 * Modellerer MUTASJONEN: en timer-implementasjon der handleTimeout kalles fra
 * en callback effekten BEHOLDER (pause-funksjon, setInterval), og der tikken
 * derfor ikke lenger står i deps. Da kan det skje renders — spilleren svarer på
 * spørsmål — uten at effekten kjører på nytt.
 */
function simulateDeferredCallSite(binding: Binding) {
  let answers: AnswerRecord[] = []
  let totalTimeMs = 0
  const handleTimeoutRef: { current: (() => void) | null } = { current: null }

  let lastDeps: unknown[] | null = null
  let retainedCallback: (() => void) | null = null

  function render(phase: string) {
    // Regel 1: renderen fanger gjeldende answers i en ny closure.
    const answersAtRender = answers
    const handleTimeout = () => {
      const r = buildTimeoutAnswer({
        questionId: 'q3', timeLimitSeconds: 30, answers: answersAtRender,
      })
      answers = r.newAnswers
      totalTimeMs = r.newTimeMs
    }

    // Sync-effekten (deklarert FØR timer-effekten i page.tsx) kjører på hver
    // commit der handleTimeout har byttet identitet — altså hver render her.
    handleTimeoutRef.current = handleTimeout

    // Timer-effekten. Deps uten tikken: kun `phase`.
    const deps: unknown[] = [phase]
    const changed = !lastDeps || deps.some((d, i) => !Object.is(d, lastDeps![i]))
    if (changed) {
      lastDeps = deps
      // Regel 3: callbacken effekten beholder, holder på DENNE renderens closure.
      retainedCallback = binding === 'ref'
        ? () => handleTimeoutRef.current!()
        : () => handleTimeout()
    }
  }

  render('playing')                    // effekten kjører og beholder callbacken
  answers = withAnswer(answers, ans('q1', 4000))
  render('playing')                    // spilleren svarte — deps uendret
  answers = withAnswer(answers, ans('q2', 5000))
  render('playing')                    // spilleren svarte igjen — deps uendret
  retainedCallback!()                  // tiden løper ut på q3

  return { answers, totalTimeMs }
}

test('MUTASJON: utsatt kallsted + closure MISTER svarene spilleren rakk å gi', () => {
  const { answers, totalTimeMs } = simulateDeferredCallSite('closure')
  const ids = answers.map(a => a.questionId)

  // Dette er skaden, konkret: q1 og q2 ble besvart riktig og er borte.
  assert.deepEqual(ids, ['q3'])
  assert.ok(!ids.includes('q1'), 'q1 skulle vært mistet i det stale scenarioet')
  assert.ok(!ids.includes('q2'), 'q2 skulle vært mistet i det stale scenarioet')
  // Tiden følger samme tap: 30000 i stedet for 39000.
  assert.equal(totalTimeMs, 30_000)
})

test('FIKSEN: utsatt kallsted + ref beholder alle svarene', () => {
  const { answers, totalTimeMs } = simulateDeferredCallSite('ref')

  assert.deepEqual(answers.map(a => a.questionId), ['q1', 'q2', 'q3'])
  assert.equal(totalTimeMs, 39_000)
  // Og timeout-raden er fortsatt en ekte timeout-rad, ikke bare «til stede».
  const q3 = answers.find(a => a.questionId === 'q3')!
  assert.equal(q3.selectedAnswer, null)
  assert.equal(q3.timeMs, 30_000)
})

/**
 * Modellerer koden slik den FAKTISK er i dag: kallet skjer synkront i
 * effekt-kroppen, og tikken (timeLeft) står i deps. Kontrollen som viser at
 * dagens form ikke har en stale sti — med begge bindingene.
 */
function simulateSyncCallSite(binding: Binding) {
  let answers: AnswerRecord[] = []
  let totalTimeMs = 0
  const handleTimeoutRef: { current: (() => void) | null } = { current: null }
  let lastDeps: unknown[] | null = null

  function render(phase: string, timeLeft: number) {
    const answersAtRender = answers
    const handleTimeout = () => {
      const r = buildTimeoutAnswer({
        questionId: 'q3', timeLimitSeconds: 30, answers: answersAtRender,
      })
      answers = r.newAnswers
      totalTimeMs = r.newTimeMs
    }
    handleTimeoutRef.current = handleTimeout

    const deps: unknown[] = [phase, timeLeft]
    const changed = !lastDeps || deps.some((d, i) => !Object.is(d, lastDeps![i]))
    if (!changed) return
    lastDeps = deps
    // Regel 2+3: effekt-kroppen kjører i den nyeste renderen, og kallet skjer
    // her og nå — ingenting beholdes.
    if (timeLeft <= 0) {
      if (binding === 'ref') handleTimeoutRef.current!()
      else handleTimeout()
    }
  }

  render('playing', 2)
  answers = withAnswer(answers, ans('q1', 4000))
  render('playing', 1)
  answers = withAnswer(answers, ans('q2', 5000))
  render('playing', 0)                 // tiden løper ut

  return { answers, totalTimeMs }
}

test('KONTROLL: dagens synkrone kallsted er ferskt med BEGGE bindingene', () => {
  for (const binding of ['closure', 'ref'] as const) {
    const { answers, totalTimeMs } = simulateSyncCallSite(binding)
    assert.deepEqual(
      answers.map(a => a.questionId), ['q1', 'q2', 'q3'],
      `${binding}: synkront kallsted skal aldri miste svar`,
    )
    assert.equal(totalTimeMs, 39_000, `${binding}: totaltid skal være intakt`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// DEL 3 — strukturelle sperrer mot at fiksen rulles tilbake i page.tsx
// ─────────────────────────────────────────────────────────────────────────────

const SRC = readFileSync('app/quiz/[id]/page.tsx', 'utf8')

test('timer-effekten kaller handleTimeout via ref, ikke via closure', () => {
  assert.ok(
    SRC.includes('if (timeLeft <= 0) { handleTimeoutRef.current(); return }'),
    'timer-effekten skal kalle handleTimeoutRef.current(), ikke handleTimeout()',
  )
  assert.ok(
    !/if \(timeLeft <= 0\) \{ handleTimeout\(\); return \}/.test(SRC),
    'det direkte closure-kallet skal ikke være tilbake',
  )
})

test('sync-effekten står FØR timer-effekten (ellers er ref-en én commit bak)', () => {
  const syncAt = SRC.indexOf('handleTimeoutRef.current = handleTimeout }, [handleTimeout])')
  const timerAt = SRC.indexOf('if (timeLeft <= 0) { handleTimeoutRef.current(); return }')
  assert.ok(syncAt > -1, 'fant ikke sync-effekten som oppdaterer ref-en')
  assert.ok(timerAt > -1, 'fant ikke timer-effekten')
  // React kjører passive effekter i deklarasjonsrekkefølge. Motsatt rekkefølge
  // ville gitt timer-effekten en ref fra forrige commit — verre enn i dag.
  assert.ok(syncAt < timerAt, 'sync-effekten må deklareres før timer-effekten')
})

test('handleTimeout bruker den delte buildTimeoutAnswer, ikke en inline kopi', () => {
  assert.ok(
    SRC.includes('buildTimeoutAnswer({'),
    'handleTimeout skal kalle buildTimeoutAnswer fra lib/quiz-timeout-answer.ts',
  )
  assert.ok(
    !/const record: AnswerRecord = \{ questionId: question\.id, selectedAnswer: null/.test(SRC),
    'den inline record-byggingen skal være borte, ikke duplisert',
  )
})
