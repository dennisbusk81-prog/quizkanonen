// Kjører mange enkeltskrivinger parallelt og RAPPORTERER hvilke som feilet,
// i stedet for å la dem forsvinne i en `await Promise.all(...)` uten retur-
// verdisjekk.
//
// Bakgrunn: `Promise.all` over Supabase-kall resolver også når hvert enkelt
// kall returnerte `{ error }`. Supabase-js kaster nemlig ikke ved DB-feil — den
// legger feilen i returverdien. En `await Promise.all(rows.map(r => sb.update(...)))`
// ser derfor ut som «alle skrivinger gikk bra» selv når samtlige feilet.
// Nøyaktig den feilklassen sto i fasitrettings-ruten: en delvis mislykket
// regradering rapporterte likevel fullt antall oppdaterte rader til admin.
//
// Ett ekstra forsøk på KUN de som feilet er med fordi den realistiske
// feilmodusen er en forbigående glipp (connection reset, kortvarig rate limit),
// ikke en permanent feil — en umiddelbar retry fjerner de fleste av dem uten at
// admin må gjøre noe.

export type BatchWriteFailure<T> = {
  item: T
  message: string
}

export type BatchWriteOutcome<T> = {
  succeeded: T[]
  failed: BatchWriteFailure<T>[]
}

type WriteResult = { error: { message: string } | null }

/**
 * Kjører `write` for hvert element parallelt. Elementer som feiler forsøkes på
 * nytt inntil `retries` ganger (kun de feilede). Returnerer hva som faktisk
 * lyktes og hva som fortsatt feilet — kalleren MÅ håndtere `failed`.
 */
export async function runBatchWithRetry<T>(
  items: T[],
  write: (item: T) => PromiseLike<WriteResult>,
  opts: { retries?: number } = {}
): Promise<BatchWriteOutcome<T>> {
  const retries = opts.retries ?? 1

  let pending = items
  let failures: BatchWriteFailure<T>[] = []

  for (let pass = 0; pass <= retries; pass++) {
    if (pending.length === 0) break

    const results = await Promise.all(
      pending.map(async (item): Promise<BatchWriteFailure<T> | null> => {
        try {
          const { error } = await write(item)
          return error ? { item, message: error.message } : null
        } catch (err) {
          // En kastet exception (nettverksfeil, ikke en DB-feil) skal telles
          // som en feilet skriving på lik linje med `{ error }`.
          return { item, message: err instanceof Error ? err.message : String(err) }
        }
      })
    )

    failures = results.filter((r): r is BatchWriteFailure<T> => r !== null)
    pending = failures.map(f => f.item)
  }

  const failedItems = new Set(failures.map(f => f.item))
  return {
    succeeded: items.filter(item => !failedItems.has(item)),
    failed: failures,
  }
}
