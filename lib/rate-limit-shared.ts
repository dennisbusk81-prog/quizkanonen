// ── Rate-limiting med DELT teller (Upstash Redis over REST) ─────────────────
//
// BAKGRUNN
// lib/rate-limit.ts er en Map på modulnivå, altså én teller PER
// serverless-instans. Vercel kjører mange instanser parallelt og resirkulerer
// dem fortløpende, så en bruker som treffer flere instanser får i praksis
// grensen ganget opp med antall instanser de traff. Ved dagens trafikk har det
// vært en akseptert unøyaktighet; med annonsering til noen tusen mennesker på
// kort tid er det ikke lenger det.
//
// Merk at svakheten IKKE bare handler om samtidighet: admin-innlogging teller i
// et 15-minutters vindu og /submit i et 10-minutters, begge lengre enn levetiden
// til en instans. Telleren kan altså forsvinne midt i vinduet helt uten last.
//
// HVA SOM ER MIGRERT — OG HVA SOM BEVISST IKKE ER DET
// Kun de kallstedene der in-memory-laget er ENESTE forsvar og konsekvensen er
// reell: admin-innlogging, Stripe-checkout/-trial, auth-innløsning, org-join,
// quiz-start/-innsending, e-postutsending og uinnlogget påmelding.
//
// Flatene med et AUTORITATIVT lag i admin_actions — verdikoder
// (lib/redeem-throttle.ts), e-postoppslag (lib/check-email-throttle.ts),
// trial-koder, dueller (lib/duel-quota.ts) og invitasjoner
// (lib/invite-quota.ts) — er IKKE rørt. Der er in-memory-kallet kun en
// burst-brems foran en teller som allerede overlever kalde starter, slik
// kommentarene i de filene sier eksplisitt. Rene lese-ruter er heller ikke
// rørt: der er grensen kostnadsdemping, og instans-spredning er harmløs.
//
// TO LAG, IKKE ETT
// In-memory sjekkes FØRST, og det er ikke bare en optimalisering: telleren på
// én instans kan aldri være høyere enn den delte, så et lokalt avslag er alltid
// også et delt avslag. Da slipper vi en nettverksrundtur for nettopp de
// forespørslene som kommer tettest — en angriper som maler mot samme instans
// betaler ingenting hos Upstash.
//
// FAIL-OPEN, IKKE FAIL-CLOSED
// Svarer ikke Upstash innen fristen, faller vi tilbake til nøyaktig dagens
// in-memory-oppførsel. Motsatt valg ville gjort en Upstash-forstyrrelse til et
// totalt utfall av innlogging, kjøp og quiz-innsending. En rate-limiter er et
// skadebegrensningstiltak; den skal aldri kunne bli den tingen som tar ned
// tjenesten. Fail-open rapporteres til Sentry (bremset, se protokoll-fila) —
// tilstanden må være synlig, ikke stille.
//
// INERT UTEN ENV
// Mangler KV_REST_API_URL/KV_REST_API_TOKEN, gjør modulen ingen nettverkskall
// og oppfører seg identisk med lib/rate-limit.ts. Samme mønster som
// Sentry-DSN-en: env-variabelens tilstedeværelse ER funksjonsbryteren, så en
// utrulling kan slås av ved å fjerne den — uten ny deploy av kode. Lokalt er
// variablene ikke satt (de ligger på Production/Preview), så `npm run dev`
// kjører rent in-memory.
import { rateLimit } from '@/lib/rate-limit'
import { withTimeout, type TimerApi } from '@/lib/with-timeout'
import {
  buildCounterCommands,
  decideFromCount,
  keyPrefixOf,
  parseCounterResponse,
  shouldReportFailOpen,
  type RateLimitOutcome,
} from '@/lib/rate-limit-protocol'

/**
 * Frist for rundturen til Upstash.
 *
 * Satt høyt nok til at en KALD instans rekker TLS-håndtrykket sitt — en for
 * kort frist ville gitt fail-open nettopp når instanser churner, altså i
 * akkurat den situasjonen delt teller finnes for. Og lavt nok til at et
 * fullstendig Upstash-utfall koster ett sekund per forespørsel og ikke henger.
 * Normal rundtur Frankfurt↔Frankfurt er noen få millisekunder; fristen skal
 * aldri slå inn i normal drift.
 */
export const SHARED_RATE_LIMIT_TIMEOUT_MS = 1000

export type FailOpenInfo = {
  /** Kun delen før kolon — aldri IP eller bruker-id. Se keyPrefixOf. */
  keyPrefix: string
  reason: string
  timedOut: boolean
}

export type SharedRateLimitDeps = {
  fetchImpl?: typeof fetch
  timers?: TimerApi
  now?: () => number
  /** Injiserbar så testene slipper å laste Sentry. */
  onFailOpen?: (info: FailOpenInfo) => void
  /** Injiserbar så testene slipper å rote med process.env. */
  env?: { url?: string; token?: string }
}

// Per instans. Nullstilles ved kald start, som er riktig: en ny instans skal
// få lov til å rapportere at den ikke når Upstash.
let lastFailOpenReportAt: number | null = null

function defaultReporter(info: FailOpenInfo): void {
  // Dynamisk import: holder @sentry/nextjs utenfor modulgrafen til testene og
  // ut av den varme stien. Feiler importen (eller Sentry selv), skal en
  // rate-limit-sjekk ALDRI kunne kaste videre av den grunn.
  void import('@sentry/nextjs')
    .then(Sentry => {
      Sentry.captureMessage('rate-limit-shared: fail-open mot Upstash', {
        level: 'warning',
        extra: { keyPrefix: info.keyPrefix, reason: info.reason, timedOut: info.timedOut },
      })
    })
    .catch(() => {})
}

function readEnv(): { url?: string; token?: string } {
  // Leses per kall, ikke som modul-konstant. Da kan testene skru delt lagring
  // av og på uten å laste modulen på nytt, og en env-endring i Vercel får
  // effekt ved neste kalde start uten at noe er bakt inn ved import-tidspunkt.
  return {
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  }
}

/**
 * Samme kontrakt som `rateLimit`, men telleren deles av alle instanser.
 *
 * Returnerer ALLTID et svar — den kaster ikke, uansett hva Upstash gjør.
 */
export async function rateLimitShared(
  key: string,
  limit: number,
  windowMs: number,
  deps: SharedRateLimitDeps = {},
): Promise<RateLimitOutcome> {
  const {
    fetchImpl = fetch,
    timers,
    now = Date.now,
    onFailOpen = defaultReporter,
    env = readEnv(),
  } = deps

  // Lokalt lag først. Kjøres ALLTID, også når Redis svarer, slik at telleren på
  // instansen holdes varm og kan bære alene ved en senere fail-open.
  const local = rateLimit(key, limit, windowMs)
  if (!local.success) return local

  const url = env.url?.replace(/\/+$/, '')
  const token = env.token
  if (!url || !token) return local

  const failOpen = (reason: string, timedOut: boolean): RateLimitOutcome => {
    const t = now()
    if (shouldReportFailOpen(t, lastFailOpenReportAt)) {
      lastFailOpenReportAt = t
      try {
        onFailOpen({ keyPrefix: keyPrefixOf(key), reason, timedOut })
      } catch {
        // En rapportør som kaster skal ikke kunne velte forespørselen.
      }
    }
    return local
  }

  const controller = new AbortController()
  const request = fetchImpl(`${url}/multi-exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildCounterCommands(key, windowMs)),
    signal: controller.signal,
    // Svaret er per definisjon ferskvare — Next skal ikke cache det.
    cache: 'no-store',
  })

  const outcome = await withTimeout(request, {
    ms: SHARED_RATE_LIMIT_TIMEOUT_MS,
    // Uten denne ville det hengende kallet blitt liggende og ventet i
    // bakgrunnen lenge etter at vi har svart brukeren.
    onTimeout: () => controller.abort(),
    timers,
  })

  if (!outcome.ok) {
    return failOpen(outcome.timedOut ? 'timeout' : 'nettverksfeil', outcome.timedOut)
  }

  const response = outcome.value
  if (!response.ok) {
    return failOpen(`HTTP ${response.status}`, false)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return failOpen('ugyldig JSON', false)
  }

  const parsed = parseCounterResponse(json)
  if (!parsed.ok) return failOpen(parsed.reason, false)

  return decideFromCount(parsed.count, limit)
}

/** Kun for tester — nullstiller rapporterings-bremsen mellom testtilfeller. */
export function __resetFailOpenReportGate(): void {
  lastFailOpenReportAt = null
}
