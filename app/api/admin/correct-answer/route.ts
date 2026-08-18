import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'
import { runBatchWithRetry } from '@/lib/batch-write'
import { resyncSeasonScoresForQuiz } from '@/lib/resync-season-scores'
import {
  parseAnswerKey,
  readStoredKey,
  answerKeyColumns,
  gradeAnswerRows,
  planAttemptTotals,
} from '@/lib/answer-key-correction'

// Ruten oppdaterer alle svarrader og alle berørte forsøk, og rekalkulerer
// deretter season_scores for quizen. Alt synkront (se under) — standardgrensen
// er for knapp for en quiz med mange spillere.
//
// DETTE ER DEN ENESTE KODESTIEN som skal endre fasiten på et spørsmål som alt
// er spilt. Den vanlige PATCH-ruten (quizzes/[id]/questions/[qid]) hadde fram
// til nå en egen, udokumentert regradering som hverken oppdaterte attempts
// eller season_scores — den er fjernet, og PATCH låser nå fasitendringer på
// spilte spørsmål og henviser hit. Se lib/answer-key-correction.ts.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 401 })
  }

  let body: { questionId?: string; newCorrectAnswer?: string; newCorrectAnswers?: string[] }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const { questionId } = body

  if (!questionId) {
    return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 })
  }

  // `newCorrectAnswers` (array) er den nye formen. `newCorrectAnswer` (én
  // bokstav) beholdes som alias slik at en klient som ikke er oppdatert ennå
  // ikke brekker — rekkefølgen på deploy front/back spiller dermed ingen rolle.
  const requestedKey = body.newCorrectAnswers ?? body.newCorrectAnswer
  if (requestedKey === undefined) {
    return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 })
  }

  // Fetch the question
  const { data: question, error: qErr } = await supabaseAdmin
    .from('questions')
    .select('id, question_text, quiz_id, correct_answer, correct_answers')
    .eq('id', questionId)
    .single()

  if (qErr || !question) {
    return NextResponse.json({ error: 'Spørsmål ikke funnet' }, { status: 404 })
  }

  // num_options avgjør hvilke bokstaver som i det hele tatt finnes på quizen —
  // uten denne kunne fasiten settes til D på en quiz med tre alternativer, og
  // spørsmålet ville blitt umulig å svare riktig på.
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('num_options')
    .eq('id', question.quiz_id)
    .maybeSingle()

  const parsed = parseAnswerKey(requestedKey, quiz?.num_options ?? 4)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const keys = parsed.keys
  const previousKey = readStoredKey(question)

  // Skriv fasiten. correct_answers settes til NULL når det bare er ett riktig
  // svar — samme form som «Spørsmål»-siden skriver ved opprettelse, slik at det
  // ikke finnes to representasjoner av samme fasit i tabellen.
  const { error: keyErr } = await supabaseAdmin
    .from('questions')
    .update(answerKeyColumns(keys))
    .eq('id', questionId)

  if (keyErr) {
    return NextResponse.json({ error: `Kunne ikke lagre fasiten: ${keyErr.message}` }, { status: 500 })
  }

  // Fetch all attempt_answers for this question — paginert full henting.
  // Bundet til antall forsøk på quizen (ett svar per forsøk per spørsmål),
  // men uten eksplisitt grense kutter PostgREST stille ved 1000 rader —
  // ville latt noen spilleres poeng stå urettet uten varsel.
  const answers = await fetchAllRows<{ id: string; attempt_id: string; selected_answer: string | null }>((from, to) =>
    supabaseAdmin
      .from('attempt_answers')
      .select('id, attempt_id, selected_answer')
      .eq('question_id', questionId)
      .order('id', { ascending: true })
      .range(from, to)
  )

  if (answers.length === 0) {
    return NextResponse.json({
      updated: 0,
      question: question.question_text,
      correctAnswers: keys,
      previousCorrectAnswers: previousKey,
    })
  }

  // Update is_correct for each answer. Regraderingen skjer i JS (ikke som to
  // brede UPDATE-er med .eq/.neq mot selected_answer): .neq matcher ALDRI
  // NULL-rader i Postgres, så timeout-svar ville blitt hoppet over. Her får de
  // eksplisitt is_correct = false, og flere riktige svar håndteres av includes.
  //
  // Skrivingene kjøres gjennom runBatchWithRetry, ikke en rå Promise.all:
  // Supabase-js kaster ikke ved DB-feil, den legger feilen i returverdien. En
  // `await Promise.all(...)` uten sjekk resolver derfor også når skrivinger
  // feilet, og ruten rapporterte da fullt antall rettede rader til admin selv om
  // ingenting ble skrevet. Feilede rader forsøkes én gang til (forbigående
  // glipp er den realistiske feilmodusen) og rapporteres om de fortsatt feiler.
  const regraded = gradeAnswerRows(answers, keys)
  const answerWrites = await runBatchWithRetry(regraded, r =>
    supabaseAdmin
      .from('attempt_answers')
      .update({ is_correct: r.is_correct })
      .eq('id', r.id)
  )

  if (answerWrites.failed.length > 0) {
    console.error(
      `[correct-answer] ${answerWrites.failed.length} av ${regraded.length} svarrader kunne ikke ` +
      `oppdateres — question=${questionId} quiz=${question.quiz_id}. ` +
      `Første feil: ${answerWrites.failed[0].message}. ` +
      `attempt_answers.id: ${answerWrites.failed.map(f => f.item.id).join(', ')}`
    )
  }

  // Recalculate scores for all affected attempts
  const attemptIds = [...new Set(answers.map(a => a.attempt_id))]

  // Spørsmålene i quizen, i spillerekkefølge. correct_streak må beregnes over
  // hele rekken i order_index-rekkefølge — ikke over radene slik de tilfeldigvis
  // ligger i attempt_answers. (attempts.question_order er NULL for alle rader i
  // prod, så order_index ER den faktiske rekkefølgen spilleren så spørsmålene i.)
  const quizQuestions = await fetchAllRows<{ id: string; order_index: number }>((from, to) =>
    supabaseAdmin
      .from('questions')
      .select('id, order_index')
      .eq('quiz_id', question.quiz_id)
      .order('order_index', { ascending: true })
      .range(from, to)
  )

  // Alle svarrader for de berørte forsøkene, hentet i ÉN paginert spørring i
  // stedet for én COUNT-spørring per forsøk (den gamle løsningen gjorde N kall).
  const allRows = await fetchAllRows<{ attempt_id: string; question_id: string; is_correct: boolean }>((from, to) =>
    supabaseAdmin
      .from('attempt_answers')
      .select('attempt_id, question_id, is_correct')
      .in('attempt_id', attemptIds)
      .range(from, to)
  )
  // Nye totaler per forsøk. Tellingen og streak-beregningen ligger i
  // lib/answer-key-correction.ts (ren funksjon, dekket av tester) — se
  // kommentaren der for hvorfor duplikate rader telles rått og hvorfor streaken
  // MÅ regnes over order_index-rekkefølgen.
  const totals = planAttemptTotals(allRows, quizQuestions.map(q => q.id))

  // MERK: attempts har ingen 'score'-kolonne — har aldri hatt (bekreftet
  // i migrasjonen 20260401000002: "correct_answers is the score column").
  // Update-kallet skrev tidligere ["correct_answers", "score", ...] i ett
  // og samme kall; siden Postgres avviser en UPDATE med en ukjent kolonne
  // i sin helhet (PGRST204), feilet HELE denne skrivingen stille hver
  // eneste gang — verken correct_answers eller correct_streak ble noen
  // gang faktisk lagret av denne ruten. Den feilen ville nå blitt fanget og
  // rapportert av feilsjekken under i stedet for å passere ubemerket.
  const attemptWrites = await runBatchWithRetry(attemptIds, (attemptId) => {
    const t = totals.get(attemptId) ?? { correctAnswers: 0, correctStreak: 0 }
    return supabaseAdmin
      .from('attempts')
      .update({ correct_answers: t.correctAnswers, correct_streak: t.correctStreak })
      .eq('id', attemptId)
  })

  if (attemptWrites.failed.length > 0) {
    console.error(
      `[correct-answer] ${attemptWrites.failed.length} av ${attemptIds.length} forsøk kunne ikke ` +
      `oppdateres — question=${questionId} quiz=${question.quiz_id}. ` +
      `Første feil: ${attemptWrites.failed[0].message}. ` +
      `attempts.id: ${attemptWrites.failed.map(f => f.item).join(', ')}`
    )
  }

  // ── season_scores ──────────────────────────────────────────────────────────
  // En fasitretting flytter plasseringer, og season_scores er et øyeblikksbilde
  // som ingenting ellers re-trigger. Uten dette steget måtte sesong-topplisten
  // rettes manuelt etterpå med et frittstående skript.
  //
  // SYNKRONT, ikke waitUntil, av tre grunner:
  //   1. Rekkefølge: rangeringen MÅ leses etter at attempts over er skrevet.
  //      I samme request er det gratis garantert, og to rettinger på samme quiz
  //      rett etter hverandre kan ikke race mot hverandre.
  //   2. Synlighet: en bakgrunnsjobb som feiler gir bare en logglinje. Nøyaktig
  //      den feilklassen (stille skrivefeil) er grunnen til at denne ruten aldri
  //      lagret noe i det hele tatt før i dag. Nå ligger resultatet i responsen.
  //   3. Kostnad: dette er strengt mindre arbeid enn svarrad- og forsøks-
  //      oppdateringene ruten allerede gjør synkront.
  //
  // Kun quizen fasiten tilhører er berørt — hver quiz rangeres isolert. Måned/
  // kvartal/år er ikke egne rader, men SUM over season_scores i RPC-en, så de
  // følger automatisk når points endres.
  //
  // KJØRER OGSÅ VED DELVIS SKRIVEFEIL, med vilje. Både totals-beregningen over
  // og resyncen her leser tilstanden PÅ NYTT fra databasen, ikke fra minnet.
  // Kjeden attempt_answers → attempts → season_scores forblir derfor internt
  // konsistent selv om noen rader ikke ble skrevet — den reflekterer bare en
  // delvis anvendt fasit. Å hoppe over resyncen ville gjort det verre: attempts
  // oppdatert, season_scores utdatert. Ruten er idempotent, så en ny kjøring av
  // samme retting fanger opp etternølerne (se writeFailures i responsen).
  const seasonScores = await resyncSeasonScoresForQuiz(question.quiz_id)

  // Forsidens topp 3 leses gjennom unstable_cache (60s). Cronen purger den hvert
  // minutt uansett, men når en admin nettopp har rettet en fasit skal effekten
  // være synlig med én gang.
  if (seasonScores.updated > 0) {
    revalidateTag('home-shared-data', { expire: 0 })
  }

  try {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      action_type: 'correct_answer',
      scope_type: 'quiz',
      scope_id: question.quiz_id,
    })
    if (logErr) console.error('[correct-answer] admin_actions-logging feilet', question.quiz_id, logErr)
  } catch (err) {
    console.error('[correct-answer] admin_actions-logging kastet', question.quiz_id, err)
  }

  // `updated` er nå antall FAKTISK skrevne svarrader, ikke antall forsøkte.
  // Ved delvis feil får admin et eget felt å reagere på i stedet for en
  // suksessmelding som skjuler at noen spilleres poeng står urettet.
  const failedAnswers = answerWrites.failed.length
  const failedAttempts = attemptWrites.failed.length

  return NextResponse.json({
    updated: answerWrites.succeeded.length,
    attempted: answers.length,
    ...(failedAnswers > 0 || failedAttempts > 0
      ? { writeFailures: { answers: failedAnswers, attempts: failedAttempts } }
      : {}),
    question: question.question_text,
    correctAnswers: keys,
    previousCorrectAnswers: previousKey,
    seasonScores: {
      checked: seasonScores.checked,
      updated: seasonScores.updated,
      unresolvable: seasonScores.unresolvable,
      error: seasonScores.error,
    },
  })
}
