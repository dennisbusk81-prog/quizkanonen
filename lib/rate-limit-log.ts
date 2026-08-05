// ── Loggspor når en rate-limit faktisk BITER ────────────────────────────────
//
// PROBLEMET (kartlagt 5. august 2026)
// Et 429 fra rate-limit-lagene var helt usynlig. Rutene gjør
// `return NextResponse.json(…, { status: 429 })` — en normal respons, ikke et
// kast — så `Sentry.captureRequestError` (via `onRequestError` i
// instrumentation.ts) utløses ikke. Det fantes heller ingen console-linje.
// Eneste spor var rå HTTP-status i Vercels request-logg, og der filtrerer
// `--query path` ikke (målt tidligere), så man måtte hente ufiltrert og grepe.
//
// Konsekvensen var at vi ikke kunne svare på «traff ekte brukere taket i går?»
// — verken før eller etter. Det er nettopp spørsmålet grensene finnes for.
//
// Merk at Sentry IKKE plukker opp console automatisk her: `captureConsole`
// er ikke aktivert i noen av de tre initene. Dette er altså et rent
// Vercel-loggspor, med vilje — billigere og mindre støyende enn en
// Sentry-hendelse som førstesteg. Blir volumet interessant, er neste steg å
// løfte det til Sentry, ikke å logge mer.
//
// ── PERSONVERN: HVORFOR FUNKSJONEN TAR HELE NØKKELEN ────────────────────────
// Nøklene bærer det vi IKKE vil logge — `start-attempt:user:<uuid>`,
// `submit:anon:<ip>`, `live-ranking:<ip>:<quizId>`. `lib/sentry-scrub.ts`
// fanger ikke vilkårlige verdier i `extra`, og en Vercel-logglinje skrubbes
// ikke i det hele tatt.
//
// Derfor tar funksjonen HELE nøkkelen og skreller den selv, i stedet for å ta
// et ferdig prefiks. Da kan ingen kaller sende inn for mye ved et uhell — det
// er strukturelt umulig å få IP eller bruker-id ut herfra. Samme
// «rens ved sinket»-mønster som escapingen i lib/email-templates.ts og
// skrubbingen i lib/sentry-scrub.ts.
//
// `quizId` er et eget, valgfritt felt fordi det IKKE er personopplysning —
// det står i hver eneste offentlige URL (/quiz/<id>) — og fordi det er den
// mest nyttige konteksten vi har: «skjedde dette under fredagsquizen?».
import 'server-only'
import { keyPrefixOf } from './rate-limit-protocol'

/**
 * Søkbar ropemarkør. ÉN konstant, ikke tre kopier — samme lærdom som
 * EMAIL_BATCH_SIZE i lib/email-batch.ts: et tall/en streng som står flere
 * steder driver fra hverandre, og da slutter grep-en å finne alt.
 *
 * Søk i Vercel-loggen på nøyaktig denne strengen.
 */
export const RATE_LIMIT_HIT_MARKER = '[rate-limit] TAK TRUFFET'

export type RateLimitHitInfo = {
  /**
   * `burst` = lag 1, in-memory brems per IP foran token-oppslaget.
   * `delt`  = lag 2, den ekte grensen (Upstash).
   * `lokal` = en rute med bare ett in-memory-lag (f.eks. live-ranking).
   *
   * Nødvendig fordi prefikset alene ikke skiller lagene: både
   * `start-attempt:pre:<ip>` og `start-attempt:user:<id>` gir prefikset
   * `start-attempt`.
   */
  lag: 'burst' | 'delt' | 'lokal'
  limit: number
  windowMs: number
  /**
   * Om kalleren hadde en VERIFISERT identitet. Boolsk, aldri id-en.
   * Skiller det alarmerende tilfellet (en ekte innlogget spiller ble
   * avvist) fra det forventede (anonym trafikk mot taket).
   */
  innlogget?: boolean
  /** Offentlig identifikator, ikke personopplysning. */
  quizId?: string
}

/**
 * Logger at en grense bet. Kun nøkkelPREFIKSET slipper ut — se toppkommentar.
 */
export function logRateLimitHit(key: string, info: RateLimitHitInfo): void {
  console.warn(RATE_LIMIT_HIT_MARKER, {
    rute: keyPrefixOf(key),
    lag: info.lag,
    grense: `${info.limit}/${Math.round(info.windowMs / 1000)}s`,
    ...(info.innlogget === undefined ? {} : { innlogget: info.innlogget }),
    ...(info.quizId === undefined ? {} : { quizId: info.quizId }),
  })
}
