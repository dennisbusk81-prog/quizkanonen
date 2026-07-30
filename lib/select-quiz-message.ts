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
  // Kategori spilleren har >= CATEGORY_MESSAGE_THRESHOLD riktige i, utledet av
  // computeTopCategory() i goToNext (app/quiz/[id]/page.tsx). null når ingen
  // kvalifiserer — grenen faller da stille gjennom.
  topCategory: string | null
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

// Utleder kategorien spilleren har flest riktige i (minst
// CATEGORY_MESSAGE_THRESHOLD), eller null. Ren funksjon — kalles fra goToNext
// med page.tsx sin lokale state; ingen nettverk, ingen DB.
//
// Kobler på questionId → question.id, IKKE på indeks: withAnswer flytter et
// re-besvart spørsmål bakerst i answers ved gjenopptakelse, så indeksene i
// answers og questions kan avvike.
//
// Tie-break ved likt antall riktige: kategorien til det SISTE riktige svaret
// blant de uavgjorte vinner (følger øyeblikket spilleren nettopp var i, og er
// like deterministisk som alfabetisk — uten systematisk slagside mot samme
// kategorier hver gang). Alfabetisk kun som siste utvei; i praksis unåbar,
// siden enhver uavgjort kategori har minst ett riktig svar å finne bakover.
export function computeTopCategory(
  answers: { questionId: string; isCorrect: boolean }[],
  questions: ({ id: string; category: string | null } | undefined)[],
): string | null {
  // id → trimmet kategori. Ekskluderte og tomme kategorier utelates helt —
  // spørsmålene deres teller ikke, på linje med spørsmål uten kategori.
  const catById = new Map<string, string>()
  for (const q of questions) {
    const trimmed = q?.category?.trim()
    if (!q || !trimmed) continue
    if (CATEGORY_MESSAGE_EXCLUDED.includes(trimmed.toLowerCase())) continue
    catById.set(q.id, trimmed)
  }

  // Riktige per kategori. Nøkkel: lowercase (så «Historie» og «historie»
  // teller sammen), visningsform: den sist sette trimmede varianten.
  const counts = new Map<string, { count: number; display: string }>()
  for (const a of answers) {
    if (!a.isCorrect) continue
    const cat = catById.get(a.questionId)
    if (!cat) continue
    const key = cat.toLowerCase()
    counts.set(key, { count: (counts.get(key)?.count ?? 0) + 1, display: cat })
  }

  let max = 0
  for (const { count } of counts.values()) if (count > max) max = count
  if (max < CATEGORY_MESSAGE_THRESHOLD) return null

  const tied = new Set<string>()
  for (const [key, { count }] of counts) if (count === max) tied.add(key)
  if (tied.size === 1) {
    const [key] = tied
    return counts.get(key)!.display
  }

  // Flere uavgjorte: siste riktige svar blant dem avgjør.
  for (let i = answers.length - 1; i >= 0; i--) {
    const a = answers[i]
    if (!a.isCorrect) continue
    const cat = catById.get(a.questionId)
    if (cat && tied.has(cat.toLowerCase())) return counts.get(cat.toLowerCase())!.display
  }

  // Siste utvei — alfabetisk på visningsformen.
  return [...tied].map(key => counts.get(key)!.display).sort()[0]
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
    topCategory,
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

  // 3. Innspurt — 3 eller færre igjen
  if (remaining > 0 && remaining <= 3) {
    return fill(pick('final_push', seed), { remaining })
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

  // 7. Sterk kategori
  if (topCategory) {
    return fill(pick('category', seed), { category: topCategory })
  }

  // 8. Rival
  if (rival) {
    return fill(pick('rival_intro', seed), { rivalName: rival.name })
  }

  // 9. Default — nøytral, sann i enhver tilstand
  return fill(pick('generic', seed), {})
}
