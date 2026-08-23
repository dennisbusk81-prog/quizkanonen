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
// Format: "<utstedt-i-ms>.<flagg>.<base64url-signatur>". attemptId og quizId
// ligger bevisst IKKE i tokenet — de utledes av forespørselen og signaturen
// regnes på nytt, så et token kan ikke bære med seg sin egen (manipulerte)
// identitet.
//
// ── PREMIUM-KRAVET I TOKENET (P-2, 23. august 2026) ──────────────────────────
// Live-rutene under spilling (ranking-snapshot, live-ranking, standings) sendte
// eksakt plassering — og nabonavn — til enhver kaller, uten noen premium-sjekk.
// Å gate dem krever en identitet, og identitet koster: `auth.getUser` +
// `getUserPremium` er TO serielle rundturer (målt 23. august mot eu-west-1:
// 151–196 ms og 154–188 ms — like dyre, ingen av dem gratis). Ranking-snapshot
// ble kalt 21,6 ganger per spiller 21. august, og ETT av kallstedene
// (`fetchLiveRank`) ligger `await`et rett etter at spilleren trykker på et svar.
// ~43 ekstra rundturer per spiller per quiz, på den mest latenskritiske flaten
// vi har.
//
// Derfor bæres premium-status som et SIGNERT KRAV i tokenet i stedet: lest ÉN
// gang ved start-attempt (der `auth.getUser` uansett skjer, og der profilraden
// uansett hentes for suspensjonssperren), verifisert med lokal HMAC på hver
// live-rute. Null nettverk per kall — og `liveRateLimitKey` regner allerede
// nøyaktig den signaturen, så kravet er reelt gratis der.
//
// Flagget ligger INNE i den signerte nyttelasten. En angriper kan ikke flippe
// "f" til "p" uten server-hemmeligheten, like lite som de kan flytte tokenet
// til et annet forsøk.
//
// FERSKHET, ærlig sagt: kravet er så ferskt som forsøket. Kjøper noen Premium
// midt i en quiz, sier tokenet fortsatt "gratis" til de laster siden på nytt
// (reload går via start-attempt, som utsteder nytt token — også på
// `reused`-grenen). Det er ikke en lekkasje, kun en forsinkelse i én retning,
// og klienten tåler avviket: responsene bærer eksplisitt hva serveren avgjorde
// (`userRank: null`), så visningen følger svaret og ikke klientens egen
// antakelse. Se paritetsavsnittet i lib/live-premium.ts.
//
// BAKOVERKOMPATIBILITET (må bestå gjennom minst én deploy): et token utstedt av
// forrige versjon har TO segmenter og ingen flagg. Det verifiseres fortsatt —
// mot den gamle nyttelasten — og leses som ikke-premium. Uten den grenen ville
// en spiller med åpen fane midt i quizen under deploy mistet BÅDE questions og
// submit, altså ikke kunne levere. Prisen er at en Premium-spiller i det samme
// vinduet ser spennet i stedet for eksakt plass til neste sidelast. Ikke fjern
// grenen "som opprydding" uten å vite at ingen gamle tokens er i omløp.

const TOKEN_TTL_MS = 6 * 60 * 60 * 1000 // 6 timer — rikelig for en full quizrunde

// Ett tegn hver, og de må ALDRI inneholde punktum: segmentdelingen under er
// det eneste som skiller nytt format fra gammelt.
const FLAG_PREMIUM = 'p'
const FLAG_FREE = 'f'

export type AttemptClaims = {
  /** Var kalleren Premium da forsøket ble startet? */
  premium: boolean
}

export type AttemptTokenRead =
  | { valid: false; premium: false }
  | { valid: true; premium: boolean }

function signingKey(): string | null {
  return process.env.QUIZ_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/** Nyttelasten flagget signeres sammen med — flagget er aldri utenfor signaturen. */
function payloadFor(attemptId: string, quizId: string, issued: string, flag: string | null): string {
  return flag === null
    ? `${attemptId}:${quizId}:${issued}`          // gammelt format (kun verifisering)
    : `${attemptId}:${quizId}:${issued}:${flag}`
}

export function createAttemptToken(
  attemptId: string,
  quizId: string,
  claims: AttemptClaims = { premium: false },
): string | null {
  const key = signingKey()
  if (!key) return null
  const issued = String(Date.now())
  const flag = claims.premium ? FLAG_PREMIUM : FLAG_FREE
  return `${issued}.${flag}.${sign(payloadFor(attemptId, quizId, issued, flag), key)}`
}

/**
 * Verifiser tokenet OG les kravene ut av det.
 *
 * `premium` er ALDRI true uten at signaturen er gyldig — et ugyldig token gir
 * `{ valid: false, premium: false }`, aldri en halv sannhet en kaller kan
 * komme til å lese isolert.
 */
export function readAttemptToken(token: string, attemptId: string, quizId: string): AttemptTokenRead {
  const invalid = { valid: false, premium: false } as const

  const key = signingKey()
  if (!key) return invalid

  // base64url inneholder aldri punktum, så segmentantallet skiller formatene
  // entydig: 2 = gammelt (uten flagg), 3 = nytt.
  const parts = token.split('.')
  if (parts.length !== 2 && parts.length !== 3) return invalid

  const issued = parts[0]
  const flag = parts.length === 3 ? parts[1] : null
  const providedSig = parts[parts.length - 1]
  if (!issued || !providedSig) return invalid
  if (flag !== null && flag !== FLAG_PREMIUM && flag !== FLAG_FREE) return invalid

  // Signatur først: en ugyldig signatur skal aldri kunne skilles fra et utløpt
  // token på responstid eller rekkefølge.
  const expectedSig = sign(payloadFor(attemptId, quizId, issued, flag), key)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length) return invalid
  if (!timingSafeEqual(a, b)) return invalid

  const issuedMs = Number(issued)
  if (!Number.isFinite(issuedMs)) return invalid
  if (Date.now() > issuedMs + TOKEN_TTL_MS) return invalid

  return { valid: true, premium: flag === FLAG_PREMIUM }
}

/**
 * Ren gyldighetssjekk — brukt av questions/submit, som ikke bryr seg om
 * kravene. Tynn innpakning rundt readAttemptToken med vilje: to uavhengige
 * verifiseringer er to sjanser til å avvike (samme regel som klient/server-
 * pariteten i lib/admin-session.ts).
 */
export function verifyAttemptToken(token: string, attemptId: string, quizId: string): boolean {
  return readAttemptToken(token, attemptId, quizId).valid
}

export const ATTEMPT_TOKEN_TTL_MS = TOKEN_TTL_MS
