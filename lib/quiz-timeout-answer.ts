// Ren logikk for å registrere et svar i klientens `answers`-state under spilling.
//
// Flyttet UENDRET ut av app/quiz/[id]/page.tsx 5. august 2026. Ingen
// atferdsendring — `withAnswer` er byte-identisk med originalen, og
// `buildTimeoutAnswer` gjør nøyaktig de fire stegene `handleTimeout` gjorde
// inline (bygg record → withAnswer → summer tid fra newAnswers → returner).
//
// Hvorfor flyttet: `handleTimeout` kalles fra timer-effekten uten å stå i
// effektens dependency-liste. Beskyttelsen mot en utdatert closure lå i at
// kallet skjer synkront i effekt-kroppen — et strukturelt sammentreff, ikke et
// design. For å kunne MUTASJONSBEVISE hva en utdatert closure faktisk koster,
// måtte record-byggingen ligge et sted en test kan kjøre den ekte koden fra.
// Prosjektet har ingen jsdom/react-testing-library, så dette er eneste vei til
// et bevis som treffer produksjonskode. Se lib/quiz-timeout-answer.test.ts.

export type AnswerRecord = {
  questionId: string
  selectedAnswer: string | null
  isCorrect: boolean
  timeMs: number
}

// Legger til/erstatter svaret for record.questionId i stedet for å alltid appende.
// Uten dette kunne et gjenopptatt spørsmål (side lastet på nytt midt i quizen,
// resumeData.index peker på det SISTE besvarte spørsmålet — se startQuiz) få to
// rader for samme spørsmål hvis brukeren svarte på det igjen: den gamle
// gjenopptatte raden OG den nye ville begge blitt sendt til submit, som satte inn
// begge i attempt_answers uten deduplisering. Siste svar for et spørsmål vinner.
export function withAnswer(prev: AnswerRecord[], record: AnswerRecord): AnswerRecord[] {
  return [...prev.filter(a => a.questionId !== record.questionId), record]
}

// Et timeout-svar: spilleren rakk ikke å svare, så tiden settes til hele
// tidsgrensen for spørsmålet og svaret registreres som ubesvart.
//
// `selectedAnswer: null` er MENINGSBÆRENDE, ikke «tomt» — det er signalet
// /submit bruker for å skille et ubesvart spørsmål fra et feil svar. (Timeout-
// svar ble tidligere forkastet stille i submit-ruten; derav kommentaren.)
export function buildTimeoutAnswer(args: {
  questionId: string
  timeLimitSeconds: number
  answers: AnswerRecord[]
}): { record: AnswerRecord; newAnswers: AnswerRecord[]; newTimeMs: number } {
  const record: AnswerRecord = {
    questionId: args.questionId,
    selectedAnswer: null,
    isCorrect: false,
    timeMs: args.timeLimitSeconds * 1000,
  }
  const newAnswers = withAnswer(args.answers, record)
  // Summert fra newAnswers, ikke inkrementert fra forrige totalTimeMs: hvis dette
  // spørsmålet allerede hadde et svar (gjenopptatt midt i quiz, se withAnswer),
  // ville et inkrement lagt den nye tiden OPPÅ den gamle i stedet for å erstatte
  // den — total_time_ms er tiebreaker på topplista og må reflektere nøyaktig én
  // tid per spørsmål.
  const newTimeMs = newAnswers.reduce((sum, a) => sum + a.timeMs, 0)
  return { record, newAnswers, newTimeMs }
}
