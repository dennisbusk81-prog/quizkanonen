// ── Delt sendebudsjett mot Resend: 10 forespørsler/sekund PER KONTO ─────────
//
// BAKGRUNN (kartlagt 16. august 2026)
// Resends grense gjelder kontoen, ikke ruten — men hver e-postsendende rute
// pacet seg selv (typisk 8/s via dispatchInBatches) som om den hadde hele
// budsjettet alene. 8. august kl. 08:00 kjørte weekly-report,
// notify-subscribers og trial-reminders i samme minutt, og trial-reminders
// fikk 5 mottakere avvist med Resend 429. Kollisjonen er dessuten strukturelt
// garantert fredag kveld: send-reminders og notify-subscribers fyrer på samme
// quiz-åpning mot hver sin liste, ~8/s hver. Og de hendelsesdrevne flatene —
// send-invite (opptil 50 samtidige kall), Stripe-webhooken — er ikke tidsstyrt
// i det hele tatt, så ingen mengde intern pacing i cron-rutene kan dekke dem.
//
// Derfor håndheves budsjettet i sendEmail() (lib/email.ts) — ved SINKET, samme
// mønster som escapingen i email-templates.ts og Sentry-rapporteringen i
// email.ts: alle kallsteder arver det, og et nytt kallsted kan ikke glemme det.
//
// MODELLEN: én delt teller PER EPOKESEKUND i Upstash (`rl:resend:<sekund>`).
// En sending reserverer plass med INCRBY; står telleren over 10 etterpå, er
// sekundet fullt, og senderen VENTER til neste sekundgrense og prøver igjen.
// Det er den avgjørende forskjellen fra rate-limit-shared: en innkommende
// HTTP-forespørsel kan avvises med 429 tilbake til en bruker som prøver igjen
// selv — en e-post kan ikke. Riktig respons er å vente på tur.
//
// BEVISST UTEN in-memory-forlag (avvik fra rate-limit-shared): det laget
// finnes der for å spare rundturer på per-bruker-nøkler med mange treff fra
// samme instans. Her roterer nøkkelen hvert sekund, og Map-vinduet i
// lib/rate-limit.ts (som starter ved første treff, ikke på sekundgrensen)
// ville ikke ligget på linje med epokesekundene — en feiljustert lokal teller
// kunne nektet en plass den delte telleren ville gitt. Prisen er én rundtur
// (~9 ms målt median, 5. august) per e-post — støy mot Resends egen svartid.
//
// FAIL-OPEN, IKKE FAIL-CLOSED — og hvorfor det er trygt HER:
// Svarer ikke Upstash, sendes e-posten uten reservasjon — altså nøyaktig
// dagens oppførsel før denne modulen fantes. Verste utfall ved fail-open er
// dagens verste utfall: Resend svarer 429, mottakeren stemples ikke, og neste
// kjøring prøver på nytt. Fail-closed ville derimot gjort et Upstash-utfall
// til full e-poststans — kjøpsbekreftelser og betalingsvarsler inkludert. En
// budsjett-gate er skadebegrensning; den skal aldri selv kunne bli den tingen
// som stopper utsendingen. Tilstanden rapporteres til Sentry (bremset til
// 1/minutt per instans) så den er synlig, ikke stille.
//
// INERT UTEN ENV: mangler KV_REST_API_URL/KV_REST_API_TOKEN gjøres ingen
// nettverkskall og alt slipper gjennom umiddelbart — samme funksjonsbryter som
// rate-limit-shared. Lokal `npm run dev` og testene kjører dermed uten
// budsjett, som er meningen.
import { withTimeout, type TimerApi } from '@/lib/with-timeout'
import { SHARED_RATE_LIMIT_TIMEOUT_MS } from '@/lib/rate-limit-shared'
import {
  buildBudgetCommands,
  parseCounterResponse,
  shouldReportFailOpen,
} from '@/lib/rate-limit-protocol'

/** Resends dokumenterte kontogrense. */
export const RESEND_MAX_PER_SECOND = 10

/**
 * Levetid for sekund-nøkkelen. Må overleve sitt eget sekund med margin, slik
 * at en instans med litt etterslep på klokka fortsatt treffer samme nøkkel som
 * de andre — og være kort nok til at nøkkelrommet holder seg rent (én nøkkel
 * per sekund med trafikk, død to sekunder senere).
 */
export const RESEND_SLOT_TTL_MS = 2000

/**
 * Maks antall VENTERUNDER før vi gir opp (én runde = vent til neste
 * sekundgrense og prøv igjen, altså ≤ 1 s per runde og ~10 s totalt).
 *
 * Dimensjoneringen: den største kjente enkelt-bursten er send-invite med 50
 * samtidige sendinger — den trenger 5 sekunder på 10/s, så 10 runder gir 2×
 * margin. Samtidig etterlater 10 s ventetid minst 40 s av cron-rutenes 50 s
 * arbeidsbudsjett, så en sulteforet batch rekker fortsatt å bli stemplet.
 * Et HØYERE tak ville latt ventingen spise hele budsjettet: da stopper
 * dispatchInBatches på tid i stedet, og skillet «gav opp → ikke stemplet →
 * neste kjøring prøver igjen» er nettopp semantikken et Resend-429 har i dag.
 */
export const MAX_WAIT_ROUNDS = 10

export type ResendBudgetDeps = {
  fetchImpl?: typeof fetch
  timers?: TimerApi
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Injiserbar så testene slipper å laste Sentry. */
  onFailOpen?: (info: { reason: string; timedOut: boolean }) => void
  /** Injiserbar så testene slipper å rote med process.env. */
  env?: { url?: string; token?: string }
}

// Per instans, samme brems som i rate-limit-shared: ett Upstash-utfall under
// en utsending skal gi ett varsel i minuttet, ikke ett per e-post.
let lastFailOpenReportAt: number | null = null

function defaultReporter(info: { reason: string; timedOut: boolean }): void {
  // Dynamisk import av samme grunn som i rate-limit-shared: Sentry holdes
  // utenfor modulgrafen til testene, og en feilende import skal aldri kunne
  // velte en e-postsending.
  void import('@sentry/nextjs')
    .then(Sentry => {
      Sentry.captureMessage('resend-budget: fail-open mot Upstash', {
        level: 'warning',
        extra: { reason: info.reason, timedOut: info.timedOut },
      })
    })
    .catch(() => {})
}

function readEnv(): { url?: string; token?: string } {
  // Per kall, ikke modul-konstant — samme begrunnelse som rate-limit-shared:
  // env-endringer i Vercel virker fra neste kalde start, og testene kan skru
  // budsjettet av og på uten modul-relast.
  return {
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export type ReserveOutcome = 'ok' | 'full'

/**
 * Ett forsøk: reserver `n` plasser i INNEVÆRENDE sekund.
 *
 * `'ok'` dekker også fail-open og manglende env — kalleren skal aldri måtte
 * skille «fikk plass» fra «budsjettet er utilgjengelig»; begge betyr «send».
 * `'full'` betyr at sekundet er overbooket og at et nytt forsøk må vente til
 * neste sekundgrense (der nøkkelen er en annen).
 *
 * Merk om n > 1: en avvist reservasjon lar de talte plassene stå i nøkkelen.
 * Det er harmløst for n=1 (sekundet var allerede fullt, og nøkkelen dør etter
 * 2 s), men en framtidig kaller med stor `n` ville overdempe andre sendere i
 * samme sekund. sendEmail bruker alltid n=1.
 */
export async function reserveResendSlots(
  n: number,
  deps: ResendBudgetDeps = {},
): Promise<ReserveOutcome> {
  const {
    fetchImpl = fetch,
    timers,
    now = Date.now,
    onFailOpen = defaultReporter,
    env = readEnv(),
  } = deps

  const url = env.url?.replace(/\/+$/, '')
  const token = env.token
  if (!url || !token) return 'ok'

  const failOpen = (reason: string, timedOut: boolean): ReserveOutcome => {
    const t = now()
    if (shouldReportFailOpen(t, lastFailOpenReportAt)) {
      lastFailOpenReportAt = t
      try {
        onFailOpen({ reason, timedOut })
      } catch {
        // En rapportør som kaster skal ikke kunne velte en e-postsending.
      }
    }
    return 'ok'
  }

  // Nøkkelen ER vinduet: ett epokesekund. Ingen IP, ingen bruker-id — nøkkelen
  // kan ikke lekke noe, uansett hvor den logges.
  const key = `resend:${Math.floor(now() / 1000)}`

  const controller = new AbortController()
  const request = fetchImpl(`${url}/multi-exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildBudgetCommands(key, RESEND_SLOT_TTL_MS, n)),
    signal: controller.signal,
    cache: 'no-store',
  })

  const outcome = await withTimeout(request, {
    ms: SHARED_RATE_LIMIT_TIMEOUT_MS,
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

  // Inklusiv grense, samme off-by-one-kontrakt som decideFromCount: står
  // telleren på nøyaktig 10 etter VÅR reservasjon, var vi nr. 10 og får plass.
  return parsed.count > RESEND_MAX_PER_SECOND ? 'full' : 'ok'
}

/**
 * Skaff ÉN plass i budsjettet — vent på tur om nødvendig.
 *
 * `{ ok: false }` betyr at budsjettet var fullt gjennom alle venterundene.
 * Kalleren (sendEmail) kaster da samme feilform som ved et Resend-429 i dag,
 * slik at hver rutes eksisterende håndtering — ikke stemple, plukk opp ved
 * neste kjøring — virker uendret.
 */
export async function acquireResendSlot(
  deps: ResendBudgetDeps = {},
): Promise<{ ok: boolean }> {
  const { now = Date.now, sleep = defaultSleep } = deps

  for (let attempt = 0; ; attempt++) {
    const outcome = await reserveResendSlots(1, deps)
    if (outcome === 'ok') return { ok: true }
    if (attempt >= MAX_WAIT_ROUNDS) return { ok: false }

    // Vent til NESTE sekundgrense — der er nøkkelen en annen og telleren
    // starter på null. Å vente et fast antall ms ville truffet samme fulle
    // sekund igjen når ventingen startet tidlig i sekundet.
    await sleep(1000 - (now() % 1000))
  }
}

/** Kun for tester — nullstiller rapporterings-bremsen mellom testtilfeller. */
export function __resetResendBudgetReportGate(): void {
  lastFailOpenReportAt = null
}
