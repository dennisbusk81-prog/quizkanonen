// ── Rate-limit-nøkkel for live-rutene under spilling (22. august 2026) ──────
//
// Samme feilklasse som spillestien (funn F1, lib/play-rate-limit.ts): en
// IP-adresse er ikke en person. `live-ranking` nøklet på `<ip>:<quizId>`,
// 30/60s — bak Elkjøps kontornett spiller ~20 Premium-brukere med ~2 kall/min
// hver (MÅLT 21. august, ikke anslått), altså ~40/min mot et tak på 30. At det
// ikke biter i dag skyldes utelukkende at telleren er per serverless-instans —
// en tilfeldighet, ikke en sikkerhet. Og symptomet ved 429 er HELT stille:
// klienten får null og mellomskjermen vises uten plassering.
//
// IDENTITETEN ER ATTEMPT-TOKENET, IKKE BRUKER-ID
// Spillestien løste F1 med `auth.getUser` → `<rute>:user:<id>`. Det kan ikke
// gjenbrukes her: disse rutene gjør null auth i dag, og et GoTrue-nettverkskall
// per spørsmål ville spist latency-budsjettet NEXT_STEP_TIMEOUT_MS på
// mellomskjermen. Attempt-tokenet er billigere OG bredere: verifiseringen er
// lokal HMAC (lib/attempt-token.ts, ingen nettverk), klienten har det allerede
// i state ved alle rangeringskallene, og GJESTER har det også — user-id-nøkling
// ville latt alle gjester bak ett nett dele anon-bøtta. Flomflaten er bundet
// fordi start-attempt selv er rate-limitet (20/10min): en angriper kan ikke
// fabrikkere tokens (krever server-hemmeligheten) og kan ikke høste dem
// raskere enn start-attempt deler dem ut.
//
// Gyldig token   → `<rute>:attempt:<attemptId>` — egen kvote per forsøk.
// Ellers         → `<rute>:anon:<ip>`           — samme fallback-form som
//                   spillestien (c29d56b). En spiller med åpen fane midt i
//                   quizen under deploy sender ingen token; hun skal falle
//                   hit og spille videre uten å merke noe.
//
// Verifiseringen ligger INNE i nøkkelfunksjonen, ikke hos kallerne — samme
// «rens ved sinket»-mønster som lib/email-templates.ts: da kan ingen framtidig
// rute nøkle på en UVERIFISERT attempt-id. Et påstått attemptId uten gyldig
// signatur havner i anon-bøtta, så en angriper kan ikke rotere id-er for
// uendelig kvote.
import 'server-only'
import { verifyAttemptToken } from './attempt-token'

/**
 * Grensen på live-ranking — UENDRET fra før re-nøklingen (30/60s, in-memory).
 * Denne commiten endrer kun hvem som telles sammen, ikke hvor mye. Ny
 * dimensjonering (og grense på ranking-snapshot) er steg 3, ut fra de målte
 * tallene 21. august. Delt teller (Upstash) er steg 4.
 */
export const LIVE_RANKING_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const

/**
 * Bygger rate-limit-nøkkelen for en live-rute.
 *
 * `attemptId` og `token` kommer rett fra forespørselen (query + x-attempt-token)
 * og er UVERIFISERT input — derfor verifiseres signaturen her, mot den quizen
 * forespørselen faktisk gjelder. Tokenet kan ikke flyttes til et annet forsøk
 * eller en annen quiz (HMAC over attemptId+quizId, se lib/attempt-token.ts).
 *
 * Nøkkelen beholder rute-prefikset som første ledd fordi `keyPrefixOf`
 * (lib/rate-limit-protocol.ts) sender nettopp det leddet videre ved logging —
 * alt etter første kolon (attempt-id eller IP) holdes utenfor loggen.
 */
export function liveRateLimitKey(
  route: 'live-ranking',
  opts: {
    ip: string
    quizId: string
    attemptId: string | null
    token: string | null
  },
): string {
  const { ip, quizId, attemptId, token } = opts
  const verified = !!(attemptId && token && verifyAttemptToken(token, attemptId, quizId))
  return verified ? `${route}:attempt:${attemptId}` : `${route}:anon:${ip}`
}
