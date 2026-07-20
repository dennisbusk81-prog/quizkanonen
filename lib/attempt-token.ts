import { createHmac, timingSafeEqual } from 'crypto'

// ── Signert, tidsbegrenset attempt-token ─────────────────────────────────────
// Server-only (bruker node:crypto og en server-hemmelighet).
//
// BAKGRUNN: /api/quiz/[id]/questions leverte spørsmål til hvem som helst som
// kjente quiz-id og en attempt-id. Et lite script kunne dermed hente fasiten for
// hele quizen på forhånd — ett kall per index — uten å spille i det hele tatt.
// /submit hadde tilsvarende ingen kobling mellom den som startet forsøket og
// den som leverte det.
//
// Nå: start-attempt utsteder et token som er HMAC-signert over (attemptId,
// quizId, utstedelsestidspunkt). Både questions og submit krever tokenet i
// x-attempt-token og regner signaturen på nytt mot attempt-id-en og quiz-id-en
// forespørselen faktisk gjelder. Tokenet kan derfor ikke flyttes til et annet
// forsøk eller en annen quiz, og kan ikke lages uten server-hemmeligheten.
//
// Nøkkelen er QUIZ_TOKEN_SECRET hvis den finnes, ellers SUPABASE_SERVICE_ROLE_KEY
// — begge er server-only hemmeligheter som allerede er satt i Vercel. Ingen ny
// miljøvariabel må på plass før deploy. Vil vi senere rotere separat, holder det
// å sette QUIZ_TOKEN_SECRET; ingen annen kode må endres.
//
// Format: "<utstedt-i-ms>.<base64url-signatur>". attemptId og quizId ligger
// bevisst IKKE i tokenet — de utledes av forespørselen og signaturen regnes på
// nytt, så et token kan ikke bære med seg sin egen (manipulerte) identitet.

const TOKEN_TTL_MS = 6 * 60 * 60 * 1000 // 6 timer — rikelig for en full quizrunde

function signingKey(): string | null {
  return process.env.QUIZ_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

export function createAttemptToken(attemptId: string, quizId: string): string | null {
  const key = signingKey()
  if (!key) return null
  const issued = String(Date.now())
  return `${issued}.${sign(`${attemptId}:${quizId}:${issued}`, key)}`
}

export function verifyAttemptToken(token: string, attemptId: string, quizId: string): boolean {
  const key = signingKey()
  if (!key) return false

  const dot = token.indexOf('.')
  if (dot <= 0) return false

  const issued = token.slice(0, dot)
  const providedSig = token.slice(dot + 1)
  if (!providedSig) return false

  // Signatur først: en ugyldig signatur skal aldri kunne skilles fra et utløpt
  // token på responstid eller rekkefølge.
  const expectedSig = sign(`${attemptId}:${quizId}:${issued}`, key)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length) return false
  if (!timingSafeEqual(a, b)) return false

  const issuedMs = Number(issued)
  if (!Number.isFinite(issuedMs)) return false
  return Date.now() <= issuedMs + TOKEN_TTL_MS
}

export const ATTEMPT_TOKEN_TTL_MS = TOKEN_TTL_MS
