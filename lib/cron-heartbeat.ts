// ── Kanari for cron-planleggeren (5. september 2026) ────────────────────────
//
// Tolv av femten cron-ruter kjører KUN fra cron-job.org, og dør alle på samme
// måte og i samme sekund: jobben slettes, deaktiveres, eller CRON_SECRET
// roteres — da svarer alle tolv 401 til en tjeneste ingen leser. Ingen rute
// logger 401, middleware ekskluderer /api/*, og et 401-svar er ikke et kast,
// så Sentry ser det heller ikke. Trial-reminders sto slik 9.–16. august 2026
// (auto-deaktivert av cron-job.org etter tidsavbrudd) uten at noen merket det.
//
// Dette er en DEAD MAN'S SWITCH, snudd på hodet: i stedet for at vi sjekker
// planleggeren, forventer healthchecks.io et ping fra oss innen en periode, og
// varsler Dennis på e-post når det uteblir. To kanarier, valgt med vilje:
//
//   publish-quiz          hvert minutt  → fanger «alle tolv er døde» og en
//                                         rotert hemmelighet innen minutter
//   award-season-points   hvert 30. min → fanger den ene jobben som mest
//                                         sannsynlig dør ALENE og gjør mest
//                                         skade: ruten svarer 503 by design
//                                         når en quiz ikke lar seg gjøre opp
//                                         (494db09), og cron-job.org slår en
//                                         jobb av etter >25 feil på rad —
//                                         12,5 timer. publish-quiz ville da
//                                         kjørt videre med 200 og kanarien
//                                         vært grønn.
//
// PLASSERINGEN ER HELE POENGET. Pinget sendes SIST, og KUN når feil=0.
// Sendes det ved responsen, er kanarien grønn selv om oppgjøret feilet — da
// måler den bare at cron-job.org kan nå Vercel. Kallstedene ligger derfor
// etter summeringslinja (`oppgjor:`) i begge rutene, betinget på den samme
// telleren linja skriver, og 503-grenene pinger ikke.
//
// PERIODE OG SLINGRING BOR I TJENESTEN, ikke her. Dennis endrer kadenser
// direkte i cron-job.org-panelet, og en heartbeat-forventning i kode ville
// måttet følge hver slik endring for ikke å gi falske alarmer. Koden vet
// bare «ping ved suksess»; hvor ofte det forventes, settes der sjekken bor.
//
// FAIL-OPEN, UBETINGET: dette pinget skal ALDRI kunne velte en cron-rute. En
// død healthcheck-tjeneste skal ikke ta ned sesongoppgjøret. Derfor:
//   - mangler env-verdien: hopp over stille, ingen feil (lokal utvikling,
//     preview, eller sjekken ikke opprettet ennå)
//   - kort frist (3 s) med abort, så et hengende kall ikke holder funksjonen
//   - alt fanges; funksjonen er `async` og kan derfor ikke kaste synkront
//     heller. Utfallet returneres som verdi for testenes skyld — ingen
//     kaller trenger å lese det.
//
// Ping-URL-en er en hemmelighet av lav verdi (den som har den kan forfalske
// heartbeats). Den skrives aldri til loggen: varsellinjer bærer kun
// kanari-navnet og feilens `name`, ikke `message` (fetch-feil gjentar gjerne
// URL-en i meldingen). Se også SECRET_ENV_KEYS i lib/sentry-scrub.ts.

export type HeartbeatKanari = 'publish-quiz' | 'award-season-points'

export type HeartbeatOutcome =
  /** Pinget nådde fram og tjenesten svarte 2xx. */
  | 'sent'
  /** Ingen URL i env — kanarien er ikke satt opp her. Ikke en feil. */
  | 'skipped'
  /** Nettverksfeil, tidsavbrudd eller ikke-2xx. Logget, aldri kastet. */
  | 'failed'

/** Env-nøkkelen per kanari. Verdien er ping-URL-en fra healthchecks.io. */
export const HEARTBEAT_ENV: Readonly<Record<HeartbeatKanari, string>> = {
  'publish-quiz': 'HEALTHCHECK_PUBLISH_QUIZ_URL',
  'award-season-points': 'HEALTHCHECK_AWARD_SEASON_POINTS_URL',
}

// 3 s: pinget ligger i waitUntil og koster ingen svartid, men et hengende
// kall skal ikke holde funksjonen i live opp mot maxDuration. Et ping som
// ikke rekker fram på 3 s er tapt uansett — healthchecks.io har egen
// slingring for akkurat det.
export const HEARTBEAT_TIMEOUT_MS = 3_000

export type HeartbeatDeps = {
  /** Injiserbar for tester. Standard: globalThis.fetch. */
  fetch?: typeof globalThis.fetch
  /** Injiserbar for tester. Standard: process.env. */
  env?: Record<string, string | undefined>
  /** Injiserbar for tester, så tidsavbruddet kan bevises uten å vente 3 s. */
  timeoutMs?: number
}

/**
 * Sender ett heartbeat for kanarien. Kaster aldri.
 *
 * POST, ikke GET: healthchecks.io godtar begge, men Next.js sin patchede
 * `fetch` kan cache GET på serversiden, og et cachet ping er et ping som
 * aldri ble sendt.
 */
export async function sendHeartbeat(
  kanari: HeartbeatKanari,
  deps: HeartbeatDeps = {},
): Promise<HeartbeatOutcome> {
  try {
    const env = deps.env ?? process.env
    const url = env[HEARTBEAT_ENV[kanari]]
    if (!url) return 'skipped'

    const doFetch = deps.fetch ?? globalThis.fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? HEARTBEAT_TIMEOUT_MS)
    try {
      const res = await doFetch(url, { method: 'POST', signal: controller.signal })
      if (!res.ok) {
        console.warn(`[cron-heartbeat] ${kanari}: healthchecks svarte ${res.status}`)
        return 'failed'
      }
      return 'sent'
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    // Kun `name` (AbortError, TypeError …), aldri `message` — se toppen.
    const name = err instanceof Error ? err.name : typeof err
    console.warn(`[cron-heartbeat] ${kanari}: ping feilet (${name}) — ruten er upåvirket`)
    return 'failed'
  }
}
