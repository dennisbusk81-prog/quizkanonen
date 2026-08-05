// Batchvis utsending som STEMPLER UNDERVEIS, ikke til slutt.
//
// BAKGRUNN (F4 i lastmålingsrapporten, 5. august 2026)
// `cron/notify-subscribers` sendte i batcher og skrev `notified_at` ÉN gang,
// etter at hele løkken var ferdig. Blir funksjonen drept midt i løkken — av
// Vercels funksjonsbudsjett, en deploy, eller en kald instans som resirkuleres
// — stemples INGEN. Neste kjøring ser da ingen som er varslet, og sender til
// ALLE på nytt. De som allerede fikk e-posten får den en gang til, og igjen
// ved neste avbrudd.
//
// Poenget med å stemple per batch er IKKE at koden rekker å rydde opp ved et
// avbrudd — et tidsavbrudd gir ingen catch-blokk og ingen opprydding. Poenget
// er at skrivingen til databasen ALLEREDE HAR SKJEDD for de batchene som ble
// levert. Garantien ligger i at stemplingen er utført, ikke i at avbruddet
// håndteres. Samme resonnement som «alle utganger fra try må frigjøre en lås»
// — bare at her finnes det ingen utgang i det hele tatt.
//
// De tre mekanismene under er bevisst skilt fra hverandre:
//
//   • STEMPLING PER BATCH gjør en avbrutt kjøring korrekt i ettertid.
//   • TIDSBUDSJETT gjør at vi stopper FRIVILLIG før budsjettet tar oss, slik
//     at siste batch rekker å bli stemplet. Uten dette er avbruddet fortsatt
//     korrekt, men vi mister alltid den siste batchen som var underveis.
//   • PACING holder oss under Resends grense på 10 forespørsler i sekundet.
//     `EMAIL_BATCH_SIZE` alene gjør IKKE dette — se kommentaren i
//     lib/email-batch.ts: den begrenser samtidighet, ikke gjennomstrømning,
//     så åtte kall som fullfører på 250 ms gir ~32/s uansett.
//
// Funksjonen er bevisst generisk og I/O-fri (alt av sending, stempling, klokke
// og venting injiseres). Det gjør den testbar uten nettverk, og gjenbrukbar
// for de andre cron-jobbene som har samme form.

export type BatchDispatchDeps<T> = {
  /** Sender ÉN mottaker. Kastet feil = ikke levert = ikke stemplet. */
  send: (item: T) => Promise<unknown>
  /**
   * Stempler mottakerne som faktisk ble levert i DENNE batchen.
   * Kalles etter hver batch, ikke til slutt. Kastes det her, avbrytes
   * løkken — se `stampFailed` under.
   */
  stamp: (delivered: T[]) => Promise<void>
  /** Injisert klokke (ms). */
  now: () => number
  /** Injisert venting — i test en no-op som skrur klokka fram. */
  sleep: (ms: number) => Promise<void>
  /** Kalles per mislykket sending, for logging. */
  onSendError?: (item: T, reason: unknown) => void
  /** Kalles hvis stemplingen feiler. */
  onStampError?: (reason: unknown) => void
}

export type BatchDispatchOptions = {
  /** Antall samtidige sendinger per batch. */
  batchSize: number
  /** Minste tid mellom to batch-STARTER. Styrer den vedvarende raten. */
  minBatchIntervalMs: number
  /** Slutt å starte nye batcher når så mye tid har gått. */
  budgetMs: number
}

export type BatchDispatchResult = {
  sent: number
  failed: number
  /** Mottakere vi aldri rakk å forsøke. Plukkes opp av neste kjøring. */
  remaining: number
  /** Sant hvis vi stoppet på tidsbudsjettet. */
  stoppedOnBudget: boolean
  /** Sant hvis vi stoppet fordi en stempling feilet. */
  stampFailed: boolean
  batches: number
}

export async function dispatchInBatches<T>(
  items: readonly T[],
  deps: BatchDispatchDeps<T>,
  opts: BatchDispatchOptions,
): Promise<BatchDispatchResult> {
  const { send, stamp, now, sleep, onSendError, onStampError } = deps
  const { batchSize, minBatchIntervalMs, budgetMs } = opts

  const startedAt = now()
  let index = 0
  let sent = 0
  let failed = 0
  let batches = 0
  let stoppedOnBudget = false
  let stampFailed = false
  let lastBatchStartedAt: number | null = null

  while (index < items.length) {
    // Sjekk budsjettet FØR batchen starter. En batch som er startet skal
    // alltid få fullføre og bli stemplet.
    if (now() - startedAt >= budgetMs) {
      stoppedOnBudget = true
      break
    }

    // Pacing: hold minst `minBatchIntervalMs` mellom to batch-starter. Vi
    // måler fra forrige batchs START, ikke slutt — ellers legger sendetiden
    // seg oppå intervallet og raten blir lavere enn tiltenkt.
    if (lastBatchStartedAt !== null) {
      const sinceLastStart = now() - lastBatchStartedAt
      if (sinceLastStart < minBatchIntervalMs) {
        await sleep(minBatchIntervalMs - sinceLastStart)
      }
    }

    lastBatchStartedAt = now()
    const batch = items.slice(index, index + batchSize)
    const results = await Promise.allSettled(batch.map(item => send(item)))

    const delivered: T[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        delivered.push(batch[i])
        sent++
      } else {
        failed++
        onSendError?.(batch[i], r.reason)
      }
    })

    // ── Selve poenget med hele filen ────────────────────────────────────────
    // Stemples her, mens vi står i løkken. Blir prosessen drept i neste
    // iterasjon, er denne skrivingen allerede gjennomført.
    if (delivered.length > 0) {
      try {
        await stamp(delivered)
      } catch (err) {
        // Klarer vi ikke å stemple, må vi STOPPE — ikke fortsette. Fortsatte
        // vi, ville hver videre batch sendes uten å kunne merkes, og neste
        // kjøring ville sende alt på nytt. Å stoppe her begrenser skaden til
        // de batchene som alt er sendt.
        stampFailed = true
        onStampError?.(err)
        index += batch.length
        batches++
        break
      }
    }

    index += batch.length
    batches++
  }

  return {
    sent,
    failed,
    remaining: items.length - index,
    stoppedOnBudget,
    stampFailed,
    batches,
  }
}
