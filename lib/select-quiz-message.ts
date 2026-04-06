import { quizMessages, QuizMessage, QuizMessageCategory } from './quiz-messages'

export interface QuizMessageState {
  streak: number          // consecutive correct answers ending at current question
  wrongInARow: number     // consecutive wrong answers ending at current question
  correctSoFar: number
  totalQuestions: number
  questionIndex: number   // 0-based index of question just answered (before advancing)
  rival: { name: string } | null
  scoreIsAboveMedian: boolean
}

function pick(category: QuizMessageCategory): QuizMessage {
  const msgs = quizMessages[category]
  return msgs[Math.floor(Math.random() * msgs.length)]
}

function fill(msg: QuizMessage, vars: Record<string, string | number>): QuizMessage {
  const replace = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`))
  return {
    headline: replace(msg.headline),
    subline: msg.subline ? replace(msg.subline) : null,
  }
}

export function selectQuizMessage(state: QuizMessageState): QuizMessage {
  const {
    streak,
    wrongInARow,
    correctSoFar,
    totalQuestions,
    questionIndex,
    rival,
    scoreIsAboveMedian,
  } = state

  const questionsAnswered = questionIndex + 1
  // Prosent riktige: correctSoFar / questionIndex * 100 (bruker questionIndex som nevner)
  const percent = Math.round(correctSoFar / (questionIndex || 1) * 100)
  const remaining = totalQuestions - questionsAnswered
  const isHalftime =
    questionsAnswered === Math.floor(totalQuestions / 2) && remaining > 0

  // Priority 1: streak ≥ 2
  if (streak >= 2) {
    return fill(pick('streak'), { streak })
  }

  // Priority 2: perfect run (all correct so far)
  if (correctSoFar === questionsAnswered && questionsAnswered >= 2) {
    return fill(pick('perfect_run'), {})
  }

  // Priority 3: wrong in a row ≥ 2
  if (wrongInARow >= 2) {
    return fill(pick('comeback'), {})
  }

  // Priority 4: halftime
  // halftime_good: kun hvis scoreIsAboveMedian OG ≥ 60% riktige
  // halftime_bad: aldri med prosentvariabel
  if (isHalftime) {
    if (scoreIsAboveMedian && correctSoFar / (questionIndex || 1) >= 0.6) {
      return fill(pick('halftime_good'), { percent })
    }
    return fill(pick('halftime_bad'), {})
  }

  // Priority 5: final push (3 or fewer questions left)
  if (remaining > 0 && remaining <= 3) {
    return fill(pick('final_push'), { remaining })
  }

  // Priority 6: rival intro
  if (rival) {
    return fill(pick('rival_intro'), { rivalName: rival.name })
  }

  // Default: comeback / generic encouragement
  return fill(pick('comeback'), {})
}
