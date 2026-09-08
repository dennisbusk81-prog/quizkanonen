// ── Skrivesekvensen for en arkivkopi: quiz (INAKTIV) → spørsmål → aktiver ────
//
// Trukket ut av POST /api/arkiv 8. september 2026, da POST /api/tilfeldig-quiz
// (generert quiz) trengte nøyaktig samme sekvens. Én kopi av «aktiver sist»,
// ikke to som kan gli fra hverandre. Innholdet (hva radene består av) eies
// fortsatt av buildArchiveCopy (lib/archive-copy.ts) — denne filen gjør kun
// I/O-en, i riktig rekkefølge, med riktig opprydding.
//
// ── DELVIS OPPRETTELSE ER FORBUDT — «aktiver sist» ──────────────────────────
// Importruten (app/api/admin/quizzes/import) setter quizen inn AKTIV og
// rydder med delete hvis spørsmålsinnsettet feiler — men feiler også
// ryddingen, står det igjen en tom, SPILLBAR quiz. Her settes quiz-raden
// derfor inn med is_active=false, og buildArchiveCopy sin is_active-verdi
// skrives først ETTER at spørsmålsinnsettet er bekreftet. Spillestiens
// anon-lesing krever is_active=true (samme grunn som i
// .claude/QK_TESTQUIZ_OPPSKRIFT.md), så det finnes ikke noe vindu — heller
// ikke ved dobbel feil — der en tom quiz er synlig eller spillbar.
// Spørsmålsinnsettet er ÉN batch-INSERT (én transaksjon), så «noen av
// radene» er ikke en mulig tilstand.
//
// Kilderadene røres ALDRI her. Om kilden skal bumpes (usage_count) er
// kallerens beslutning og skjer ETTER et vellykket svar herfra — /api/arkiv
// bumper ikke, /api/tilfeldig-quiz gjør det. Testdekket via begge rutenes
// integrasjonstester (lib/arkiv-create-route.test.ts,
// lib/tilfeldig-quiz-route.test.ts).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ArchiveQuestionRow, ArchiveQuizRow } from '@/lib/archive-copy'

export type ArchiveCopyWriteResult =
  | { ok: true; quizId: string }
  | { ok: false; step: 'quiz-insert' | 'questions-insert' | 'activate' }

/**
 * Skriver en ferdig bygget arkivkopi. `logPrefix` er rutens logg-etikett
 * (f.eks. '[arkiv POST]') så en feil i loggen peker på riktig inngang.
 *
 * Ved feil er svaret `{ ok: false }` og ALT som ble skrevet er forsøkt
 * ryddet; feiler ryddingen, står kun en INAKTIV (usynlig, uspillbar) rest
 * igjen, og det logges med id så den kan ryddes manuelt.
 */
export async function writeArchiveCopy(input: {
  quiz: ArchiveQuizRow
  questions: ArchiveQuestionRow[]
  logPrefix: string
}): Promise<ArchiveCopyWriteResult> {
  const { quiz, questions, logPrefix } = input

  // ── Skriving 1: quiz-raden, INAKTIV (se «aktiver sist» i filhodet) ────────
  const { data: createdQuiz, error: quizInsertError } = await supabaseAdmin
    .from('quizzes')
    .insert({ ...quiz, is_active: false })
    .select('id')
    .single()

  if (quizInsertError || !createdQuiz) {
    console.error(`${logPrefix} quiz-insert feilet:`, quizInsertError?.message)
    return { ok: false, step: 'quiz-insert' }
  }

  // ── Skriving 2: spørsmålsradene (én atomisk batch) ────────────────────────
  const { error: questionsInsertError } = await supabaseAdmin
    .from('questions')
    .insert(questions.map((q) => ({ ...q, quiz_id: createdQuiz.id })))

  if (questionsInsertError) {
    console.error(`${logPrefix} spørsmåls-insert feilet:`, questionsInsertError.message)
    const { error: cleanupError } = await supabaseAdmin
      .from('quizzes')
      .delete()
      .eq('id', createdQuiz.id)
    if (cleanupError) {
      // Ikke et hull: raden er fortsatt is_active=false og dermed hverken
      // synlig eller spillbar. Loggen finnes så restene kan ryddes manuelt.
      console.error(
        `${logPrefix} opprydding feilet — INAKTIV tom quiz ${createdQuiz.id} står igjen:`,
        cleanupError.message
      )
    }
    return { ok: false, step: 'questions-insert' }
  }

  // ── Skriving 3: aktiver — først nå blir quizen synlig/spillbar ────────────
  const { error: activateError } = await supabaseAdmin
    .from('quizzes')
    .update({ is_active: quiz.is_active })
    .eq('id', createdQuiz.id)

  if (activateError) {
    console.error(`${logPrefix} aktivering feilet:`, activateError.message)
    // Rydd begge radsettene eksplisitt (antar ikke kaskade); feiler det, står
    // quizen komplett men inaktiv — usynlig, og trygg å rydde manuelt.
    const { error: cleanupQuestionsError } = await supabaseAdmin
      .from('questions')
      .delete()
      .eq('quiz_id', createdQuiz.id)
    const { error: cleanupQuizError } = cleanupQuestionsError
      ? { error: cleanupQuestionsError }
      : await supabaseAdmin.from('quizzes').delete().eq('id', createdQuiz.id)
    if (cleanupQuizError) {
      console.error(
        `${logPrefix} opprydding etter aktiveringsfeil — INAKTIV quiz ${createdQuiz.id} står igjen:`,
        cleanupQuizError.message
      )
    }
    return { ok: false, step: 'activate' }
  }

  return { ok: true, quizId: createdQuiz.id }
}

/**
 * Sletter en arkivkopi som ALLEREDE ER AKTIVERT — brukt av
 * POST /api/tilfeldig-quiz når ledger-skrivingen (steg 8) feiler etter at
 * writeArchiveCopy over har lyktes (8. september 2026, kveld).
 *
 * Hvorfor egen funksjon og ikke oppryddingen inne i writeArchiveCopy: der er
 * quizen ALDRI aktiv når det ryddes, så et delete holder. Her ER den aktiv,
 * og ledger-raden er siden 5da09fc også TILGANGEN (eier-grenen i
 * lib/archive-play-gate.ts): en gratisbruker fikk 201 med en quizId hun ikke
 * kunne starte. Sekvensen er derfor «deaktiver først»: is_active=false →
 * spørsmål → quiz. Feiler deaktiveringen, forsøkes slettingene likevel;
 * feiler en sletting, står resten igjen og logges med id så den kan ryddes
 * manuelt. Antar ikke kaskade, av samme grunn som over.
 *
 * Returnerer om ALT ble ryddet. Kalleren svarer 503 uansett — «prøv igjen»
 * er riktig råd i begge tilfeller, siden ingen kule er bokført.
 */
export async function deleteActivatedArchiveCopy(input: {
  quizId: string
  logPrefix: string
}): Promise<{ clean: boolean }> {
  const { quizId, logPrefix } = input
  let clean = true

  const { error: deactivateError } = await supabaseAdmin
    .from('quizzes')
    .update({ is_active: false })
    .eq('id', quizId)
  if (deactivateError) {
    clean = false
    console.error(`${logPrefix} deaktivering under opprydding feilet for ${quizId}:`, deactivateError.message)
  }

  const { error: questionsError } = await supabaseAdmin
    .from('questions')
    .delete()
    .eq('quiz_id', quizId)
  if (questionsError) {
    console.error(
      `${logPrefix} opprydding feilet — quiz ${quizId} står igjen med spørsmål (is_active=${deactivateError ? 'UKJENT' : 'false'}):`,
      questionsError.message
    )
    return { clean: false }
  }

  const { error: quizError } = await supabaseAdmin
    .from('quizzes')
    .delete()
    .eq('id', quizId)
  if (quizError) {
    console.error(
      `${logPrefix} opprydding feilet — TOM quiz ${quizId} står igjen (is_active=${deactivateError ? 'UKJENT' : 'false'}):`,
      quizError.message
    )
    return { clean: false }
  }

  return { clean }
}
