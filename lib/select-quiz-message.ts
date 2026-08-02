import { quizMessages } from './quiz-messages'
import type { QuizMessage, QuizMessageCategory } from './quiz-messages'
import { seededIndex } from './seeded-shuffle'

export interface QuizMessageState {
  streak: number          // consecutive correct answers ending at current question
  wrongInARow: number     // consecutive wrong answers ending at current question
  correctSoFar: number
  totalQuestions: number
  questionIndex: number   // 0-based index of question just answered (before advancing)
  rival: { name: string } | null
  // Kategorien til spørsmålet spilleren NETTOPP svarte riktig på, forutsatt
  // >= CATEGORY_MESSAGE_THRESHOLD riktige i samme kategori totalt. Utledet av
  // computeStrongCategory() i goToNext (app/quiz/[id]/page.tsx). null når ingen
  // kvalifiserer — grenen faller da stille gjennom.
  strongCategory: string | null
}

// Streak-terskelen for mellomskjermens headline. 5 — samme terskel som
// flamme-merket på leaderboard/[id], så «streak» betyr det samme to steder.
// Streak 2–4 kommuniseres allerede av in-game-overlayet rett før mellomskjermen
// og av score-linja i QuizInterlude; headline skal ikke gjenta dem.
export const STREAK_MESSAGE_THRESHOLD = 5

// Minste antall riktige innen samme kategori før kategori-grenen slår til.
export const CATEGORY_MESSAGE_THRESHOLD = 3

// Kategorier som aldri skal gi en kategori-melding: sekkeposter, ikke
// ferdigheter («Du kan Diverse, du» er meningsløst). Matches trimmet og
// case-insensitivt — kategoriene settes manuelt i admin, så «diverse» og
// «Diverse » kan forekomme. Tekstøkten kan utvide lista.
export const CATEGORY_MESSAGE_EXCLUDED = ['diverse']

// Utleder kategorien til kategori-meldingen («Du kan {category}, du»):
// kategorien til det SIST besvarte spørsmålet, forutsatt at svaret var riktig
// og spilleren har minst CATEGORY_MESSAGE_THRESHOLD riktige i samme kategori i
// denne quizen. Ren funksjon — kalles fra goToNext med page.tsx sin lokale
// state; ingen nettverk, ingen DB.
//
// Fram til 2. august 2026 (QK_4 punkt 12) returnerte funksjonen spillerens
// BESTE kategori så langt (flest riktige totalt, med tie-break). Men meldingen
// står rett under svar-pillen for spørsmålet man nettopp besvarte og leses som
// en kommentar til akkurat det — «Du kan Historie, du» på et Geografi-spørsmål
// så ut som en glipp. Nå kreves det at siste svar er riktig OG i kategorien det
// skrytes av; terskelen på 3 beholdes, så påstanden aldri hviler på ett enkelt
// svar.
//
// Bevisst IKKE noe krav om at kategorien også er spillerens beste: «Sterk i
// Sport» er sant med 3 riktige i Sport selv om Historie står i 4 — og et
// maks-krav ville undertrykt meldingen i nøyaktig det øyeblikket den passer
// best (rett etter tredje riktige i kategorien man nettopp svarte i). Dermed
// finnes heller ingen uavgjort-situasjon å tie-breake.
//
// Kobler på questionId → question.id, IKKE på indeks: withAnswer flytter et
// re-besvart spørsmål bakerst i answers ved gjenopptakelse, så indeksene i
// answers og questions kan avvike. Siste element i answers er alltid spørsmålet
// som nettopp ble besvart (withAnswer legger det bakerst).
export function computeStrongCategory(
  answers: { questionId: string; isCorrect: boolean }[],
  questions: ({ id: string; category: string | null } | undefined)[],
): string | null {
  const last = answers[answers.length - 1]
  if (!last?.isCorrect) return null

  // id → trimmet kategori. Ekskluderte og tomme kategorier utelates helt —
  // spørsmålene deres teller ikke, på linje med spørsmål uten kategori.
  const catById = new Map<string, string>()
  for (const q of questions) {
    const trimmed = q?.category?.trim()
    if (!q || !trimmed) continue
    if (CATEGORY_MESSAGE_EXCLUDED.includes(trimmed.toLowerCase())) continue
    catById.set(q.id, trimmed)
  }

  const lastCat = catById.get(last.questionId)
  if (!lastCat) return null

  // Riktige i samme kategori, case-insensitivt («Historie» og «historie»
  // teller sammen). Visningsform: varianten på spørsmålet som nettopp ble
  // besvart — det er den spilleren har foran seg.
  const key = lastCat.toLowerCase()
  let count = 0
  for (const a of answers) {
    if (!a.isCorrect) continue
    if (catById.get(a.questionId)?.toLowerCase() === key) count++
  }
  return count >= CATEGORY_MESSAGE_THRESHOLD ? lastCat : null
}

function pick(category: QuizMessageCategory, seed: string): QuizMessage {
  const msgs = quizMessages[category]
  return msgs[seededIndex(seed, msgs.length)]
}

function fill(msg: QuizMessage, vars: Record<string, string | number>): QuizMessage {
  const replace = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`))
  return {
    headline: replace(msg.headline),
    subline: msg.subline ? replace(msg.subline) : null,
  }
}

// Meldingsvalget er en ren funksjon av (state, seed). Seeden skal være
// `${attemptId}:${questionIndex}` — da er teksten stabil gjennom re-renders og
// gjenopptakelse, men varierer på tvers av spørsmål og på tvers av uker (ny
// attemptId).
//
// Prioritetskjeden: øyeblikk slår tilstand. perfect_run/halftime/final_push er
// punkter i quizen som passeres én gang; streak/comeback er tilstander som kan
// vare i flere spørsmål og får derfor ikke skygge for dem. (Fram til 30. juli
// 2026 sto streak >= 2 øverst — det gjorde perfect_run strukturelt uoppnåelig
// fra og med spørsmål 2, siden en perfekt rekke alltid også er en streak.)
export function selectQuizMessage(state: QuizMessageState, seed: string): QuizMessage {
  const {
    streak,
    wrongInARow,
    correctSoFar,
    totalQuestions,
    questionIndex,
    rival,
    strongCategory,
  } = state

  const questionsAnswered = questionIndex + 1
  const remaining = totalQuestions - questionsAnswered
  const isHalftime =
    questionsAnswered === Math.floor(totalQuestions / 2) && remaining > 0

  // 1. Perfekt rekke — alle riktige så langt
  if (correctSoFar === questionsAnswered && questionsAnswered >= 2) {
    return fill(pick('perfect_run', seed), {})
  }

  // 2. Halvtid — nøytral, uavhengig av stilling og persentildata
  if (isHalftime) {
    return fill(pick('halftime', seed), {})
  }

  // 3. Innspurt — 3 eller færre igjen. Ved nøyaktig ett igjen brukes et eget
  // entallssett: flertallstekstene sier «de siste {remaining}» o.l., som ved 1
  // ga «Gi alt på de siste 1.» (QK_4 punkt 12).
  if (remaining > 0 && remaining <= 3) {
    return remaining === 1
      ? fill(pick('final_push_last', seed), {})
      : fill(pick('final_push', seed), { remaining })
  }

  // 4. To eller flere feil på rad
  if (wrongInARow >= 2) {
    return fill(pick('comeback', seed), {})
  }

  // 5. Streak — terskel 5, se STREAK_MESSAGE_THRESHOLD
  if (streak >= STREAK_MESSAGE_THRESHOLD) {
    return fill(pick('streak', seed), { streak })
  }

  // 6. Rett etter ett feil svar (dekker også timeout)
  if (wrongInARow === 1) {
    return fill(pick('after_wrong', seed), {})
  }

  // 7. Sterk kategori — knyttet til spørsmålet som nettopp ble besvart riktig,
  // se computeStrongCategory
  if (strongCategory) {
    return fill(pick('category', seed), { category: strongCategory })
  }

  // 8. Rival
  if (rival) {
    return fill(pick('rival_intro', seed), { rivalName: rival.name })
  }

  // 9. Default — nøytral, sann i enhver tilstand
  return fill(pick('generic', seed), {})
}
