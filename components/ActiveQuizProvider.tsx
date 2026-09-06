'use client'

import { createContext, useContext } from 'react'

// ── Id på quizen som er åpen nå, fra server til topplinjen ──────────────────
// Verdien hentes i app/layout.tsx (lib/active-quiz.ts) og leses av NavAuth
// via useActiveQuizId(). Egen context, ikke et felt i ProfileProvider:
// verdien er delt for ALLE besøkende (gjest og innlogget) og kommer fra
// server-rendering, mens ProfileProvider eier per-bruker-tilstand hentet i
// klienten. null = ingen åpen quiz, eller ukjent — begge gir «ingen Spill».
const ActiveQuizContext = createContext<string | null>(null)

export function useActiveQuizId(): string | null {
  return useContext(ActiveQuizContext)
}

export default function ActiveQuizProvider({ quizId, children }: { quizId: string | null; children: React.ReactNode }) {
  return <ActiveQuizContext.Provider value={quizId}>{children}</ActiveQuizContext.Provider>
}
