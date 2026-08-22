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
 * Grensen på live-ranking — UENDRET fra før re-nøklingen (30/60s).
 * Re-nøklingen (steg 1+2) endret hvem som telles sammen, delt teller (steg 4)
 * endret hvor telleren bor — ingen av delene endret hvor mye som slipper
 * gjennom.
 */
export const LIVE_RANKING_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const

/**
 * Grensen på ranking-snapshot (steg 3, 22. august 2026) — rutens FØRSTE
 * grense noensinne. 60 er en VURDERING forankret i måling, ikke en gjetning:
 *
 *   • Verste LEGITIME kadens per forsøk: 2 kall per spørsmål (fetchLiveRank
 *     etter svar + fetchRankingSnapshot på mellomskjermen) × ~20 spørsmål/min
 *     ved patologisk rask spilling (~3 s/spørsmål er fysisk gulv) ≈ 40/min.
 *     Reell rask spilling ligger på 8–15 kall/min.
 *   • MÅLT toppminutt 21. august 2026: 31 kall — for HELE ruten samlet, alle
 *     67 spillere (1 447 kall totalt, 21,6 per spiller over hele quizen).
 *     Grensen per ENKELTFORSØK ligger altså nesten dobbelt over det hele
 *     feltet produserte sammen i sitt travleste minutt.
 *   • 60 = patologisk tak + 50 % margin. Konsekvensen av for lav grense er
 *     at rank-pillen dør STILLE (klienten svelger 429), så romslig er riktig
 *     retning å bomme i. Kvizlengde biter ikke: selv 25 spørsmål gir maks
 *     45 kall TOTALT — man må spille hele quizen på under ett minutt for å
 *     nærme seg taket i ett vindu.
 *
 * Anon-bøtta bruker samme tall: token-løs trafikk krever en fane med bundle
 * fra før 8daf475 og er i praksis tom — restscenarioet er 1–3 spillere bak
 * samme IP under et deploy-vindu, og 60 dekker to patologiske eller ~5
 * normale. Taket gjør fortsatt jobben: 1 rps per forsøk, og antall forsøk er
 * bundet av start-attempt (20/10 min). DB-lasten er uansett dempet av
 * snapshot-cachen (TTL 10 s per quiz).
 */
export const RANKING_SNAPSHOT_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const

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
  route: 'live-ranking' | 'ranking-snapshot',
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
