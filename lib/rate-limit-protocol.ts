// ── Wire-protokollen mot Upstash REST, som REN logikk ───────────────────────
//
// Ligger i egen fil av samme grunn som lib/season-resync-plan.ts: da kan
// kommandobyggingen og svartolkningen testes direkte med `node --test` uten at
// noe nettverk, noen env-variabel eller noen timer er i bildet. I/O-siden ligger
// i lib/rate-limit-shared.ts.
//
// ─────────────────────────────────────────────────────────────────────────────
// HVORFOR «SET 0 PX <ms> NX» + «INCR» — og ikke INCR + PEXPIRE
//
// Telleren og levetiden må settes i SAMME transaksjon. Gjør man INCR først og
// PEXPIRE etterpå, finnes det et vindu der nøkkelen eksisterer UTEN utløpstid:
// slår PEXPIRE feil der, blir nøkkelen stående for alltid, og grensen går fra
// «for slapp» til «sperrer for alltid». Det er det verste utfallet av alle —
// en innlogging eller en quiz-innsending som aldri slipper gjennom igjen.
//
// SET med NX oppretter nøkkelen kun hvis den ikke finnes, med levetiden på
// plass fra første øyeblikk. INCR etterpå rører ikke TTL-en. Rekkefølgen gir
// derfor et FAST vindu — nøyaktig samme semantikk som Map-en i
// lib/rate-limit.ts, der `resetAt` settes ved første treff og aldri forlenges.
//
// Alternativet «PEXPIRE ... NX» ville vært kortere, men NX-flagget på PEXPIRE
// krever Redis 7.0+. SET med PX og NX har vært støttet siden 2.6.12 og er
// dermed uavhengig av hvilken Redis-versjon Upstash kjører under oss.
//
// VIKTIG om glidende vindu: å sette utløpstiden på nytt ved HVERT kall (PEXPIRE
// uten NX) ville låst ute en bruker som fortsetter å prøve — vinduet ville
// aldri løpe ut så lenge trafikken pågår. En spiller som treffer grensen på
// /submit ville da sittet permanent fast. Fast vindu er et bevisst valg.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alle nøkler vi eier ligger under dette prefikset.
 *
 * Databasen er delt med alt annet som måtte bli lagt inn i den senere. Prefikset
 * gjør det trivielt å se hva som er rate-limiting i Upstash-konsollen, og hindrer
 * at en framtidig cache med samme nøkkelnavn skriver over en teller.
 */
export const REDIS_KEY_PREFIX = 'rl:'

export function redisKeyFor(key: string): string {
  return `${REDIS_KEY_PREFIX}${key}`
}

/**
 * Kommandoene som sendes til /multi-exec, i rekkefølge.
 *
 * Alle argumenter er strenger: Redis-protokollen er bulk-strenger uansett, og
 * å stringifye her fjerner ethvert spørsmål om hvordan tall serialiseres på
 * veien gjennom JSON.
 */
export function buildCounterCommands(key: string, windowMs: number): string[][] {
  const rk = redisKeyFor(key)
  return [
    ['SET', rk, '0', 'PX', String(Math.max(1, Math.floor(windowMs))), 'NX'],
    ['INCR', rk],
  ]
}

/**
 * Som buildCounterCommands, men med INCRBY: en reservasjon kan gjelde flere
 * plasser i samme rundtur (brukt av det delte Resend-sendebudsjettet i
 * lib/resend-budget.ts). Semantikken er ellers identisk — SET … NX sørger for
 * at teller og levetid oppstår i samme transaksjon, se blokkommentaren øverst.
 *
 * Svaret tolkes av parseCounterResponse uendret: INCRBY returnerer
 * tellerstanden etter økningen, nøyaktig som INCR.
 */
export function buildBudgetCommands(key: string, windowMs: number, by: number): string[][] {
  const rk = redisKeyFor(key)
  return [
    ['SET', rk, '0', 'PX', String(Math.max(1, Math.floor(windowMs))), 'NX'],
    ['INCRBY', rk, String(Math.max(1, Math.floor(by)))],
  ]
}

export type ParsedCounter =
  | { ok: true; count: number }
  | { ok: false; reason: string }

/**
 * Tolker svaret fra /multi-exec.
 *
 * Formen er `[{"result":...},{"result":...}]` ved suksess, og et ENKELT
 * `{"error":"..."}`-objekt hvis hele transaksjonen ble forkastet.
 *
 * INVARIANT: en feil på ETT av de to kommandoene gjør hele svaret ubrukelig,
 * ikke bare det ene resultatet. Gikk SET feil mens INCR gikk gjennom, kan
 * nøkkelen mangle utløpstid — da har vi ingen garanti for at telleren
 * noensinne nullstilles, og å stole på tallet ville risikert en permanent
 * sperre. Kalleren skal i stedet falle åpent og la in-memory-laget avgjøre.
 */
export function parseCounterResponse(json: unknown): ParsedCounter {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const err = (json as { error?: unknown }).error
    return { ok: false, reason: typeof err === 'string' ? err : 'ukjent transaksjonsfeil' }
  }

  if (!Array.isArray(json) || json.length < 2) {
    return { ok: false, reason: 'uventet svarform' }
  }

  for (const entry of json) {
    if (entry && typeof entry === 'object' && typeof (entry as { error?: unknown }).error === 'string') {
      return { ok: false, reason: (entry as { error: string }).error }
    }
  }

  const incr = json[1] as { result?: unknown } | null
  const count = incr && typeof incr === 'object' ? incr.result : undefined
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return { ok: false, reason: 'INCR ga ikke et tall' }
  }

  return { ok: true, count }
}

export type RateLimitOutcome = { success: boolean; remaining: number }

/**
 * Beslutningen, gitt tellerstanden ETTER at dette kallet er talt med.
 *
 * Grensen er inklusiv på nøyaktig samme måte som lib/rate-limit.ts: med
 * limit=5 slipper kall 1–5 gjennom, og kall 6 avvises. Testene låser den
 * off-by-one-en fordi de to implementasjonene MÅ være enige — ellers ville en
 * rute oppført seg forskjellig avhengig av om Redis svarte eller ikke.
 */
export function decideFromCount(count: number, limit: number): RateLimitOutcome {
  if (count > limit) return { success: false, remaining: 0 }
  return { success: true, remaining: Math.max(0, limit - count) }
}

/**
 * Hvor ofte en fail-open får lov å nå Sentry, per instans.
 *
 * Er Upstash nede under en fredagsquiz, treffer HVER forespørsel fail-open.
 * Uten en brems her ville ett utfall blitt til tusenvis av events og spist
 * hele Sentry-kvoten — akkurat da vi trenger den til å se hva som ellers
 * skjer. Ett varsel i minuttet per instans er nok til å oppdage tilstanden.
 */
export const FAIL_OPEN_REPORT_INTERVAL_MS = 60_000

export function shouldReportFailOpen(
  now: number,
  lastReportAt: number | null,
  intervalMs: number = FAIL_OPEN_REPORT_INTERVAL_MS,
): boolean {
  if (lastReportAt === null) return true
  return now - lastReportAt >= intervalMs
}

/**
 * Delen av nøkkelen FØR første kolon — «submit», «admin-login», «org-join».
 *
 * Kun denne sendes til Sentry. Resten av nøkkelen er en IP-adresse eller en
 * bruker-id, altså nøyaktig det lib/sentry-scrub.ts finnes for å holde ute.
 * Skrubbingen fanger headere og kjente mønstre, ikke en vilkårlig streng vi
 * selv har lagt i `extra` — så den må ikke havne der i utgangspunktet.
 */
export function keyPrefixOf(key: string): string {
  const i = key.indexOf(':')
  return i === -1 ? key : key.slice(0, i)
}
